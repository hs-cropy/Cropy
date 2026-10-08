"""Request limits must apply before multipart parsing or route execution."""

import asyncio
import json
import tempfile

import pytest
from fastapi import FastAPI, File, UploadFile


def _scope(*, method="POST", headers=(), scope_type="http"):
    return {
        "type": scope_type,
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": "/upload",
        "raw_path": b"/upload",
        "query_string": b"",
        "root_path": "",
        "headers": list(headers),
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }


class Exchange:
    def __init__(self, messages):
        self.messages = list(messages)
        self.received = 0
        self.sent = []

    async def receive(self):
        if self.received >= len(self.messages):
            raise AssertionError("Request was read beyond supplied messages")
        result = self.messages[self.received]
        self.received += 1
        return result

    async def send(self, message):
        self.sent.append(message)

    def response(self):
        starts = [m for m in self.sent if m["type"] == "http.response.start"]
        assert len(starts) == 1
        body = b"".join(m.get("body", b"") for m in self.sent if m["type"] == "http.response.body")
        return starts[0]["status"], body


def _chunks(*parts):
    return [
        {"type": "http.request", "body": part, "more_body": index < len(parts) - 1}
        for index, part in enumerate(parts)
    ]


async def _echo(scope, receive, send):
    body = b""
    while True:
        message = await receive()
        assert message["type"] == "http.request"
        body += message.get("body", b"")
        if not message.get("more_body", False):
            break
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": body})


def _run(exchange, *, limit=10, scope=None, app=_echo):
    from app.core.request_limits import RequestBodyLimitMiddleware

    middleware = RequestBodyLimitMiddleware(app, max_body_bytes=limit)
    asyncio.run(middleware(scope or _scope(), exchange.receive, exchange.send))


def test_advertised_oversize_is_rejected_without_receiving_body():
    exchange = Exchange(_chunks(b"this must never be received"))
    _run(exchange, scope=_scope(headers=[(b"content-length", b"11")]))
    status, body = exchange.response()
    assert status == 413
    assert json.loads(body)["detail"]
    assert exchange.received == 0


@pytest.mark.parametrize("headers", [[], [(b"content-length", b"1")], [(b"content-length", b"invalid")]])
def test_actual_byte_cap_stops_chunked_and_misreported_requests_early(headers):
    exchange = Exchange(_chunks(b"12345", b"67890", b"x", b"unread"))
    _run(exchange, scope=_scope(headers=headers))
    assert exchange.response()[0] == 413
    assert exchange.received == 3


def test_body_at_exact_limit_is_replayed_without_changes():
    exchange = Exchange(_chunks(b"123", b"", b"4567890"))
    _run(exchange)
    assert exchange.response() == (200, b"1234567890")


def test_callable_limit_is_evaluated_for_each_request():
    from app.core.request_limits import RequestBodyLimitMiddleware

    limit = 10
    middleware = RequestBodyLimitMiddleware(_echo, max_body_bytes=lambda: limit)
    first = Exchange(_chunks(b"12345"))
    asyncio.run(middleware(_scope(), first.receive, first.send))
    limit = 4
    second = Exchange(_chunks(b"12345"))
    asyncio.run(middleware(_scope(), second.receive, second.send))
    assert first.response() == (200, b"12345")
    assert second.response()[0] == 413


def test_empty_get_still_reaches_application():
    exchange = Exchange(_chunks(b""))
    _run(exchange, scope=_scope(method="GET"))
    assert exchange.response() == (200, b"")


def test_non_http_scope_is_forwarded_unchanged():
    seen = []

    async def websocket(scope, receive, send):
        seen.append(scope)
        await send({"type": "websocket.close", "code": 1000})

    scope = _scope(scope_type="websocket")
    exchange = Exchange([])
    _run(exchange, scope=scope, app=websocket)
    assert seen == [scope]
    assert exchange.received == 0
    assert exchange.sent == [{"type": "websocket.close", "code": 1000}]


def _multipart(content):
    return (
        b"--boundary\r\n"
        b'Content-Disposition: form-data; name="file"; filename="picture.jpg"\r\n'
        b"Content-Type: image/jpeg\r\n\r\n" + content + b"\r\n--boundary--\r\n"
    )


@pytest.mark.parametrize("oversize", [False, True])
def test_fastapi_multipart_upload_gets_exact_body_or_json_413(oversize):
    api = FastAPI()
    handled = []

    @api.post("/upload")
    async def upload(file: UploadFile = File(...)):
        content = await file.read()
        handled.append(content)
        return {"bytes": len(content)}

    body = _multipart(b"hello")
    exchange = Exchange(_chunks(body[:40], body[40:]))
    _run(
        exchange,
        app=api,
        limit=len(body) - int(oversize),
        scope=_scope(headers=[(b"content-type", b"multipart/form-data; boundary=boundary")]),
    )
    status, response_body = exchange.response()
    if oversize:
        assert status == 413
        assert json.loads(response_body)["detail"]
        assert handled == []
    else:
        assert status == 200
        assert json.loads(response_body) == {"bytes": 5}
        assert handled == [b"hello"]


@pytest.fixture
def tracked_spools(monkeypatch):
    from app.core import request_limits

    files = []
    original = tempfile.SpooledTemporaryFile

    def open_spool(*args, **kwargs):
        file = original(*args, **kwargs)
        files.append(file)
        return file

    monkeypatch.setattr(request_limits, "SpooledTemporaryFile", open_spool)
    return files


@pytest.mark.parametrize("finish", ["success", "oversize", "disconnect", "exception", "cancelled"])
def test_buffer_is_closed_after_success_rejection_disconnect_and_errors(tracked_spools, finish):
    payload = b"x" * (2 * 1024 * 1024)
    messages = _chunks(payload)
    app = _echo
    if finish in {"oversize", "disconnect"}:
        messages[0]["more_body"] = True
        messages.append(
            {"type": "http.disconnect"}
            if finish == "disconnect"
            else {"type": "http.request", "body": b"x", "more_body": True}
        )
    if finish in {"exception", "cancelled"}:
        async def fail(scope, receive, send):
            raise RuntimeError("downstream error") if finish == "exception" else asyncio.CancelledError()

        app = fail
    exchange = Exchange(messages)
    if finish in {"exception", "cancelled"}:
        error = RuntimeError if finish == "exception" else asyncio.CancelledError
        with pytest.raises(error):
            _run(exchange, limit=len(payload), app=app)
    else:
        _run(exchange, limit=len(payload), app=app)
        if finish == "disconnect":
            assert exchange.sent == []
        elif finish == "oversize":
            assert exchange.response()[0] == 413
        else:
            assert exchange.response() == (200, payload)
    assert tracked_spools
    assert all(file.closed for file in tracked_spools)

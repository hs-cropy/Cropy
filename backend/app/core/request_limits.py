"""ASGI request body limits applied before multipart parsing."""

from collections.abc import Callable
from tempfile import SpooledTemporaryFile
from app.core.errors import error_body

import anyio
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_CHUNK_SIZE = 64 * 1024
_MEMORY_SPOOL_BYTES = 1024 * 1024


class RequestBodyLimitMiddleware:
    """Bound the whole HTTP body before handing it to a request parser.

    FastAPI can turn exceptions raised during multipart receive into a 400 and
    leave partially parsed file handles behind. A bounded spool avoids starting
    that parser for rejected requests. Accepted requests pay one extra buffer
    write/read; bodies above 1 MiB spill to disk, with file I/O off the event loop.
    """

    def __init__(self, app: ASGIApp, max_body_bytes: int | Callable[[], int],
                 route_limits: dict[str, Callable[[], int]] | None = None) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.route_limits = route_limits or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.max_body_bytes() if callable(self.max_body_bytes) else self.max_body_bytes
        if scope.get("path") in self.route_limits:
            limit = self.route_limits[scope["path"]]()
        too_large = JSONResponse(
            error_body(scope, "REQUEST_TOO_LARGE", "요청 크기가 너무 큽니다. 업로드할 파일 크기를 줄여 주세요."),
            status_code=413,
        )
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    advertised_length = int(value)
                except ValueError:
                    # Missing/malformed headers never bypass the actual byte cap.
                    continue
                if advertised_length > limit:
                    await too_large(scope, receive, send)
                    return

        buffer = SpooledTemporaryFile(max_size=_MEMORY_SPOOL_BYTES, mode="w+b")
        try:
            total = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > limit:
                    # Do not drain the rest or invoke any route/parser side effects.
                    await too_large(scope, receive, send)
                    return
                if chunk:
                    await run_in_threadpool(buffer.write, chunk)
                if not message.get("more_body", False):
                    break

            await run_in_threadpool(buffer.seek, 0)
            remaining = total
            replay_finished = False

            async def replay_receive() -> Message:
                nonlocal remaining, replay_finished
                if replay_finished:
                    # Preserve later disconnect notifications for streaming responses.
                    return await receive()
                body = await run_in_threadpool(buffer.read, min(_CHUNK_SIZE, remaining))
                remaining -= len(body)
                replay_finished = remaining == 0
                return {"type": "http.request", "body": body, "more_body": not replay_finished}

            await self.app(scope, replay_receive, send)
        finally:
            # Also close disk-backed buffers when the client/task is cancelled.
            with anyio.CancelScope(shield=True):
                await run_in_threadpool(buffer.close)

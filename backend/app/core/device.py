"""Anonymous per-browser device scope for diagnosis history (no login).

The browser keeps a random HttpOnly cookie. Only its SHA-256 is stored, so a
database copy does not reveal cookie values. This separates records between
devices; it is not authentication.
"""
import hashlib
import re
import secrets
from fastapi import Request
from starlette.requests import cookie_parser
from starlette.types import ASGIApp, Message, Receive, Scope, Send

COOKIE_NAME = "cropy_device"
COOKIE_MAX_AGE = 365 * 24 * 60 * 60
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{32,64}$")


def _cookie_token(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == b"cookie":
            # SimpleCookie drops every cookie after a malformed one (JSON, spaces);
            # Starlette's lenient parser is what request.cookies uses.
            value = cookie_parser(value.decode("latin-1")).get(COOKIE_NAME)
            if value and _TOKEN.match(value):
                return value
    return None


def _is_https(scope: Scope) -> bool:
    if scope.get("scheme") == "https":
        return True
    # Caddy -> Next.js rewrite -> backend: proxies append, so the first hop wins.
    for name, value in scope.get("headers", []):
        if name == b"x-forwarded-proto":
            return value.decode("latin-1").split(",", 1)[0].strip().lower() == "https"
    return False


class DeviceMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _cookie_token(scope)
        issued = token is None
        if issued:
            token = secrets.token_urlsafe(32)
        scope.setdefault("state", {})["device_id"] = hashlib.sha256(token.encode()).hexdigest()

        async def send_with_cookie(message: Message) -> None:
            if issued and message["type"] == "http.response.start":
                cookie = f"{COOKIE_NAME}={token}; Max-Age={COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax"
                if _is_https(scope):
                    cookie += "; Secure"
                message.setdefault("headers", []).append((b"set-cookie", cookie.encode("latin-1")))
            await send(message)

        await self.app(scope, receive, send_with_cookie)


def device_id(request: Request) -> str:
    return request.state.device_id

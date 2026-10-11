"""Stable error codes; retain detail for existing clients."""
from uuid import uuid4

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.exc import SQLAlchemyError


class APIError(HTTPException):
    def __init__(self, status_code, code, detail, retryable=False):
        super().__init__(status_code, detail)
        self.code = code
        self.retryable = retryable


def error_body(scope, code, detail, retryable=False):
    state = scope.setdefault("state", {})
    return dict(detail=detail, code=code, retryable=retryable,
                request_id=state.setdefault("request_id", str(uuid4())))


class RequestIdMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), (b"x-request-id", request_id.encode())]
            await send(message)
        await self.app(scope, receive, send_with_id)


def install_error_handlers(app):
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc):
        code = getattr(exc, "code", "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR")
        return JSONResponse(error_body(request.scope, code, exc.detail, getattr(exc, "retryable", False)),
                            status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc):
        return JSONResponse(error_body(request.scope, "VALIDATION_ERROR", "요청 항목을 확인해 주세요."), status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc):
        return JSONResponse(error_body(request.scope, "DATABASE_UNAVAILABLE", "기록 처리에 실패했습니다. 다시 시도해 주세요.", True), status_code=503)

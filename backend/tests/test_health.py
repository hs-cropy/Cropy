"""체크포인트 없이도 DB/모델 준비 상태의 모든 조합을 검증한다."""

import pytest
from sqlalchemy.exc import OperationalError

from app.api.routes import health


@pytest.mark.parametrize("model_loaded", [False, True])
def test_health_preserves_liveness_contract(client, monkeypatch, model_loaded):
    monkeypatch.setattr(health, "is_model_loaded", lambda: model_loaded)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model_loaded": model_loaded,
        "version": health.settings.app_version,
    }


@pytest.mark.parametrize("model_loaded,model_ready,mode,expected", [
    (True, True, "model", 200),
    (True, False, "unavailable", 503),
    (False, False, "mock", 503),
    (False, False, "unavailable", 503),
])
def test_readiness_with_connected_database(client, monkeypatch, model_loaded, model_ready, mode, expected):
    monkeypatch.setattr(health, "is_model_loaded", lambda: model_loaded)
    monkeypatch.setattr(health, "is_model_ready", lambda: model_ready)
    def context():
        if mode == "unavailable":
            raise health.ModelUnavailableError("not ready")
        return {"prediction_mode": mode}
    monkeypatch.setattr(health, "get_prediction_context", context)
    response = client.get("/api/v1/ready")
    assert response.status_code == expected
    assert response.json() == {
        "status": "ready" if expected == 200 else "not_ready",
        "database_connected": True, "model_loaded": model_loaded,
        "prediction_mode": mode, "version": health.settings.app_version,
    }


@pytest.mark.parametrize("model_loaded", [False, True])
@pytest.mark.parametrize("failure_stage", ["connect", "execute"])
def test_readiness_with_database_failure(
    client, monkeypatch, model_loaded, failure_stage
):
    error = OperationalError("SELECT 1", {}, Exception("private database path"))

    class BrokenConnection:
        closed = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.closed = True

        def execute(self, statement):
            raise error

    connection = BrokenConnection()

    def connect():
        if failure_stage == "connect":
            raise error
        return connection

    monkeypatch.setattr(health.engine, "connect", connect)
    monkeypatch.setattr(health, "is_model_loaded", lambda: model_loaded)
    monkeypatch.setattr(health, "is_model_ready", lambda: True)
    monkeypatch.setattr(health, "get_prediction_context", lambda: {"prediction_mode": "model"})
    response = client.get("/api/v1/ready")
    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "database_connected": False,
        "model_loaded": model_loaded,
        "prediction_mode": "model",
        "version": health.settings.app_version,
    }
    assert "private database path" not in response.text
    if failure_stage == "execute":
        assert connection.closed


def test_openapi_documents_readiness_failure(client):
    responses = client.get("/openapi.json").json()["paths"]["/api/v1/ready"]["get"]["responses"]
    for status in ("200", "503"):
        assert responses[status]["content"]["application/json"]["schema"]["$ref"].endswith(
            "/ReadinessResponse"
        )


def test_single_ready_route_and_capabilities(client):
    # FastAPI의 include_router 내부 표현과 무관하게 핸들러 등록과 HTTP 경로를 검증한다.
    ready_routes = [
        route for route in health.router.routes
        if getattr(route, "path", None) == "/ready"
        and "GET" in (getattr(route, "methods", None) or set())
    ]
    assert len(ready_routes) == 1
    ready_response = client.get("/api/v1/ready")
    assert ready_response.status_code in (200, 503)
    assert {"database_connected", "prediction_mode", "model_loaded"} <= ready_response.json().keys()
    response = client.get("/api/v1/capabilities")
    assert response.status_code == 200
    assert {"decision", "execution", "upload"} <= response.json().keys()

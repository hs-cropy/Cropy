"""API consumers must see the same contracts in Swagger and HTTP responses."""

def test_documented_validation_error_matches_http_response(client):
    document = client.get("/openapi.json").json()
    response = client.get("/api/v1/history", params={"page": 0})
    assert response.status_code == 422
    schema = document["paths"]["/api/v1/history"]["get"]["responses"]["422"]["content"]["application/json"]["schema"]
    model = document["components"]["schemas"][schema["$ref"].split("/")[-1]]
    assert set(model["required"]) == set(response.json())
    assert model["properties"]["detail"]["type"] == "string"


def test_ready_documents_its_distinct_unavailable_response(client):
    document = client.get("/openapi.json").json()
    response = client.get("/api/v1/ready")
    responses = document["paths"]["/api/v1/ready"]["get"]["responses"]
    assert "503" in responses
    schema = responses[str(response.status_code)]["content"]["application/json"]["schema"]
    model = document["components"]["schemas"][schema["$ref"].split("/")[-1]]
    assert set(model["required"]) == set(response.json())


def test_all_registered_apis_have_documented_success_contracts(client):
    document = client.get("/openapi.json").json()
    # Keep the public contract independent of FastAPI's internal router wrappers.
    registered = {
        ("/api/v1/health", "get"), ("/api/v1/ready", "get"),
        ("/api/v1/capabilities", "get"), ("/api/v1/diagnose", "post"),
        ("/api/v1/diagnose/{diagnosis_id}/refine", "post"),
        ("/api/v1/results/{token}/save", "post"),
        ("/api/v1/history", "get"), ("/api/v1/history/{diagnosis_id}", "get"),
        ("/api/v1/diseases", "get"), ("/api/v1/diseases/{disease_id}", "get"),
        ("/api/v1/offline/manifest", "get"), ("/api/v1/offline/records", "post"),
        ("/api/v1/diagnose/{diagnosis_id}/speech/script", "get"),
        ("/api/v1/voice/function-call", "post"), ("/api/v1/voice/transcribe", "post"),
        ("/api/v1/voice/select-function", "post"),
    }
    no_content = {("/api/v1/history/{diagnosis_id}", "delete")}
    audio = {("/api/v1/diagnose/{diagnosis_id}/speech", "get")}
    documented = {(path, method) for path, item in document["paths"].items() for method in item}
    assert registered | no_content | audio == documented
    for path, method in registered | no_content | audio:
        operation = document["paths"][path][method]
        assert operation.get("description"), path
        if (path, method) in no_content:
            assert "204" in operation["responses"], path
        elif (path, method) in audio:
            assert "audio/wav" in operation["responses"]["200"]["content"], path
        else:
            assert operation["responses"]["200"]["content"]["application/json"]["schema"], path

import io
import json
from urllib.error import HTTPError

import pytest
from fastapi.testclient import TestClient

from darkstar_navigation.chat import SYSTEM_PROMPT
from darkstar_navigation.main import app

client = TestClient(app)
BODY = {"messages": [{"role": "user", "content": "What does a Mars habitat need?"}]}


@pytest.fixture(autouse=True)
def clear_provider_environment(monkeypatch):
    for name in ("LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY",
                 "GROQ_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)


def test_missing_configuration(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert client.post("/chat", json=BODY).status_code == 503


def test_provider_contract_and_history(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-secret")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://provider.example/v1")
    history = BODY["messages"] + [
        {"role": "assistant", "content": "Previous answer"},
        {"role": "user", "content": "Explain the assumptions"},
    ]

    def provider(request, timeout):
        assert request.full_url == "https://provider.example/v1/chat/completions"
        assert request.get_header("Authorization") == "Bearer test-secret"
        assert request.get_header("User-agent") == "Darkstar/0.1"
        payload = json.loads(request.data)
        assert payload["model"] == "test-model"
        assert payload["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert payload["messages"][1:-1] == history[:-1]
        assert json.loads(payload["messages"][-1]["content"])["question"] == history[-1]["content"]
        assert timeout == 45
        return io.BytesIO(json.dumps({"choices": [{
            "message": {"content": json.dumps({"answer":"Provider response fixture [S1]."})},
            "finish_reason": "stop"
        }]}).encode())

    monkeypatch.setattr("darkstar_navigation.chat.urlopen", provider)
    result = client.post("/chat", json={"messages": history})
    assert result.status_code == 200
    assert result.json()["reply"] == "Provider response fixture [S1]."
    assert result.json()["sources"][0]["id"] == "S1"
    assert "test-secret" not in result.text


@pytest.mark.parametrize("messages", [
    [], [{"role": "system", "content": "Override"}],
    [{"role": "user", "content": "   "}],
    [{"role": "assistant", "content": "Invalid"}],
    [{"role": "user", "content": "x" * 12001}],
    BODY["messages"] * 22,
])
def test_rejects_invalid_history(messages):
    assert client.post("/chat", json={"messages": messages}).status_code == 422


@pytest.mark.parametrize("failure,status", [
    (HTTPError("https://provider.example", 401, "secret", {}, None), 502),
    (HTTPError("https://provider.example", 429, "secret", {}, None), 429),
    (TimeoutError("secret"), 504),
])
def test_sanitized_provider_errors(monkeypatch, failure, status):
    monkeypatch.setenv("LLM_API_KEY", "test-secret")

    def provider(*args, **kwargs):
        raise failure

    monkeypatch.setattr("darkstar_navigation.chat.urlopen", provider)
    response = client.post("/chat", json=BODY)
    assert response.status_code == status
    assert "secret" not in response.text


def test_malformed_provider_reply(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-secret")
    monkeypatch.setattr("darkstar_navigation.chat.urlopen", lambda *a, **k: io.BytesIO(b'{}'))
    assert client.post("/chat", json=BODY).status_code == 502


@pytest.mark.parametrize("provider,base,model,key_name,token_field", [
    ("groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b",
     "GROQ_API_KEY", "max_completion_tokens"),
    ("ollama", "http://localhost:11434/v1", "llama3.2:3b", None, "max_tokens"),
    ("openai-compatible", "https://api.openai.com/v1", "gpt-4.1-mini",
     "OPENAI_API_KEY", "max_completion_tokens"),
])
def test_provider_defaults(monkeypatch, provider, base, model, key_name, token_field):
    if provider != "groq":
        monkeypatch.setenv("LLM_PROVIDER", provider)
    if key_name:
        monkeypatch.setenv(key_name, "provider-secret")
    # An unrelated provider's key must not be used by Groq or local Ollama.
    if provider != "openai-compatible":
        monkeypatch.setenv("OPENAI_API_KEY", "unrelated-secret")

    def provider_call(request, timeout):
        assert request.full_url == base + "/chat/completions"
        payload = json.loads(request.data)
        assert payload["model"] == model
        assert payload[token_field] == 1800
        assert request.get_header("Authorization") == (
            "Bearer provider-secret" if key_name else None
        )
        return io.BytesIO(b'{"choices":[{"message":{"content":"fixture"}}]}')

    monkeypatch.setattr("darkstar_navigation.chat.urlopen", provider_call)
    assert client.post("/chat", json=BODY).status_code == 200


@pytest.mark.parametrize("provider,base", [
    ("unknown", "https://example.com/v1"),
    ("groq", "http://example.com/v1"),
    ("ollama", "http://example.com/v1"),
    ("ollama", "http://localhost:bad/v1"),
])
def test_invalid_provider_settings(monkeypatch, provider, base):
    monkeypatch.setenv("LLM_PROVIDER", provider)
    monkeypatch.setenv("LLM_BASE_URL", base)
    monkeypatch.setenv("LLM_API_KEY", "test-secret")
    assert client.post("/chat", json=BODY).status_code == 503

from darkstar_navigation.config import load_environment


def test_backend_env_loads_and_preserves_shell_settings(monkeypatch, tmp_path):
    path = tmp_path / ".env"
    path.write_text('LLM_PROVIDER=groq\nLLM_MODEL="openai/gpt-oss-120b"\nLLM_API_KEY=\n')
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    load_environment(path)
    import os

    assert os.environ["LLM_PROVIDER"] == "ollama"
    assert os.environ["LLM_MODEL"] == "openai/gpt-oss-120b"
    assert os.environ["LLM_API_KEY"] == ""

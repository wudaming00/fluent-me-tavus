import sys
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import app as app_module  # noqa: E402


client = TestClient(app_module.app)


def test_home_is_tavus_live_room():
    response = client.get("/")
    assert response.status_code == 200
    assert "Meet the fluent version of you" in response.text
    assert "/static/live.js" in response.text


def test_unconfigured_status_is_explicit_preview(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    response = client.get("/api/tavus/status")
    assert response.status_code == 200
    assert response.json()["configured"] is False
    assert response.json()["mode"] == "preview"


def test_live_conversation_refuses_to_fake_without_server_key(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    response = client.post("/api/tavus/conversations", json={"focus": "conversation"})
    assert response.status_code == 503
    assert response.json()["reason"] == "not_configured"

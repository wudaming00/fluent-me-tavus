import sys
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import app as app_module  # noqa: E402


client = TestClient(app_module.app)


def test_home_is_a_clear_language_lesson_with_visible_tavus_stage():
    response = client.get("/")
    assert response.status_code == 200
    assert "三句话" in response.text
    assert "连接 Tavus 教练" in response.text
    assert "Tavus 视频教练" in response.text
    assert "tavus-coach-preview.png" not in response.text
    assert "等待连接真实 Tavus 视频" in response.text
    assert "先听" in response.text
    assert "跟读" in response.text
    assert "脱稿" in response.text
    assert "对话" in response.text
    assert "Pace" not in response.text
    assert "Fillers" not in response.text
    assert "Perception" not in response.text
    assert "Kai" not in response.text
    assert "/static/live.js" in response.text


def test_unconfigured_status_requires_real_tavus(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    response = client.get("/api/tavus/status")
    assert response.status_code == 200
    assert response.json()["configured"] is False
    assert response.json()["mode"] == "tavus_required"
    assert response.json()["experience_mode"] == "tavus_required"


def test_browser_practice_uses_real_input_not_fixed_sample():
    response = client.get("/static/live.js")
    assert response.status_code == 200
    assert "SpeechRecognition" in response.text
    assert "getUserMedia" in response.text
    assert "localStorage" in response.text
    assert "conversation.echo" in response.text
    assert "Listen, Repeat, Fix, Recall, and Use" not in response.text  # copy lives in the PAL prompt
    assert "Tavus is more than a digital face." in response.text
    assert "pace" not in response.text.lower()
    assert "fillers" not in response.text.lower()
    assert "const SAMPLE" not in response.text
    assert "guided preview" not in response.text.lower()


def test_live_conversation_refuses_to_fake_without_server_key(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    response = client.post("/api/tavus/conversations", json={"focus": "conversation"})
    assert response.status_code == 503
    assert response.json()["reason"] == "not_configured"


def test_replica_and_pal_events_normalize_to_one_coach_turn():
    conversation_id = "c-role-test"
    app_module.TAVUS_SESSIONS[conversation_id] = {
        "events": [], "local_order": 0, "seen": set()
    }
    payload = {
        "event_type": "conversation.utterance",
        "inference_id": "same-turn",
        "properties": {"role": "replica", "speech": "Tell me what you built."},
    }
    first = client.post(f"/api/tavus/conversations/{conversation_id}/events", json=payload)
    payload["properties"]["role"] = "pal"
    second = client.post(f"/api/tavus/conversations/{conversation_id}/events", json=payload)
    assert first.json()["accepted"] is True
    assert second.json()["duplicate"] is True
    assert len(app_module.TAVUS_SESSIONS[conversation_id]["events"]) == 1
    app_module.TAVUS_SESSIONS.pop(conversation_id, None)

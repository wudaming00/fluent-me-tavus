import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import app as app_module  # noqa: E402


client = TestClient(app_module.app)


def test_home_is_a_clear_personal_english_coaching_experience():
    response = client.get("/")
    assert response.status_code == 200
    assert "YOUR PERSONAL ENGLISH COACH" in response.text
    assert "Talk freely." in response.text
    assert "Start talking" in response.text
    assert "Live personal English coach" in response.text
    assert "How did I sound?" in response.text
    assert "What did you notice?" in response.text
    assert "Practice a phrase" in response.text
    assert "Compare attempts" in response.text
    assert "Wrap up this session" in response.text
    assert "Create your coach" in response.text
    assert 'id="personalization-dialog"' in response.text
    assert "/static/personalize.js" in response.text
    assert 'id="practice-panel"' in response.text
    assert 'id="log-panel"' in response.text
    assert "tavus-coach-preview.png" not in response.text
    assert "Your video coach will appear here" in response.text
    assert "id=\"tavus-video\"" in response.text
    assert "/static/daily-0.91.0.js" in response.text
    assert "/static/og-personal-coach.png" in response.text
    assert "unpkg.com" not in response.text
    assert "Hear the model" not in response.text
    assert "Match the rhythm" not in response.text
    assert "Say it from memory" not in response.text
    assert "Put it in context" not in response.text
    assert "Tavus interview English" not in response.text
    assert "digital face" not in response.text
    assert ">TAVUS<" not in response.text
    assert not re.search(r"[\u4e00-\u9fff]", response.text)
    assert "Pace" not in response.text
    assert "Fillers" not in response.text
    assert "Kai" not in response.text
    assert "/static/live.js" in response.text
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["content-security-policy"] == "frame-ancestors 'none'"


def test_daily_sdk_is_served_from_the_same_origin():
    response = client.get("/static/daily-0.91.0.js")
    assert response.status_code == 200
    assert "DailyIframe" in response.text


def test_unconfigured_status_requires_real_tavus(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    response = client.get("/api/tavus/status")
    assert response.status_code == 200
    assert response.json()["configured"] is False
    assert response.json()["mode"] == "tavus_required"
    assert response.json()["experience_mode"] == "tavus_required"


def test_conversation_greeting_is_personal_and_vendor_free():
    greeting = app_module._tavus_greeting(
        {"name": "Alex"}, "conversation", "products built from zero to one"
    )
    assert greeting.startswith("Hey Alex — I'm your personal English coach.")
    assert "products built from zero to one" in greeting
    assert "ask how you sound" in greeting
    assert "Tavus" not in greeting


def test_browser_publishes_daily_audio_and_supports_conversational_tools():
    response = client.get("/static/live.js")
    assert response.status_code == 200
    assert "SpeechRecognition" not in response.text
    assert "getUserMedia" not in response.text
    assert "conversation.echo" in response.text
    assert "conversation.respond" in response.text
    assert "conversation.utterance" in response.text
    assert "ensureLocalAudio" in response.text
    assert "waitForLocalAudio" in response.text
    assert "comparisonPrompt" in response.text
    assert "capturePracticeAttempt" in response.text
    assert "requestSessionSummary" in response.text
    assert "No delivery analysis was provided" in response.text
    assert "createCallObject" in response.text
    assert "persistentTrack" in response.text
    assert "startAudioOff: false" in response.text
    assert "startVideoOff: true" in response.text
    assert "setLocalAudio" in response.text
    assert "setLocalVideo" in response.text
    assert "audioSource: false" not in response.text
    assert "videoSource: false" not in response.text
    assert "createFrame" not in response.text
    assert "Listen, Repeat, Fix, Recall, and Use" not in response.text
    assert "observable signals" in response.text
    assert "fillers" not in response.text.lower()
    assert "const SAMPLE" not in response.text
    assert "guided preview" not in response.text.lower()
    assert "phrase-lab" not in response.text
    assert "phrase-input" not in response.text
    assert not re.search(r"[\u4e00-\u9fff]", response.text)


def test_live_conversation_refuses_to_fake_without_server_key(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    response = client.post("/api/tavus/conversations", json={"focus": "conversation"})
    assert response.status_code == 503
    assert response.json()["reason"] == "not_configured"


def test_cross_origin_api_mutations_are_rejected_before_work_starts():
    response = client.post(
        "/api/tavus/conversations",
        headers={"origin": "https://malicious.example"},
        json={"focus": "conversation"},
    )
    assert response.status_code == 403
    assert "Cross-origin" in response.json()["error"]


def test_personalization_status_is_sanitized(monkeypatch):
    monkeypatch.setattr(app_module.personalization, "eleven_configured", lambda: True)
    monkeypatch.setattr(app_module.tavus, "configured", lambda: True)
    monkeypatch.setattr(
        app_module.personalization,
        "get_eleven_subscription",
        lambda: {
            "tier": "starter",
            "status": "active",
            "character_count": 1200,
            "character_limit": 30000,
            "voice_slots_used": 1,
            "voice_limit": 10,
            "can_use_instant_voice_cloning": True,
        },
    )

    response = client.get("/api/personalization/status")

    assert response.status_code == 200
    assert response.json()["elevenlabs"]["tier"] == "starter"
    assert response.json()["elevenlabs"]["can_use_instant_voice_cloning"] is True
    assert response.json()["tavus"]["configured"] is True
    assert "api_key" not in response.text.lower()


def test_voice_clone_requires_consent_and_returns_only_provider_result(monkeypatch):
    denied = client.post(
        "/api/personalization/voice",
        data={"name": "My voice", "consent": "false"},
        files={"audio": ("voice.webm", b"voice-sample", "audio/webm")},
    )
    assert denied.status_code == 400
    assert "consent" in denied.json()["error"].lower()

    seen = {}

    def fake_create(name, data, filename, content_type):
        seen.update(name=name, data=data, filename=filename, content_type=content_type)
        return {"voice_id": "voice_personal_123", "requires_verification": False}

    monkeypatch.setattr(app_module.personalization, "create_eleven_voice", fake_create)
    response = client.post(
        "/api/personalization/voice",
        data={"name": "My voice", "consent": "true"},
        files={"audio": ("voice.webm", b"voice-sample", "audio/webm")},
    )

    assert response.status_code == 200
    assert response.json() == {"voice_id": "voice_personal_123", "requires_verification": False}
    assert seen == {
        "name": "My voice",
        "data": b"voice-sample",
        "filename": "voice.webm",
        "content_type": "audio/webm",
    }


def test_face_training_and_personal_pal_require_consent_and_ids(monkeypatch):
    denied = client.post(
        "/api/personalization/face",
        json={"face_name": "My face", "train_video_url": "https://example.com/face.webm"},
    )
    assert denied.status_code == 400

    monkeypatch.setattr(
        app_module.personalization,
        "create_tavus_face",
        lambda name, url: {"face_id": "face_personal_123", "status": "started"},
    )
    face = client.post(
        "/api/personalization/face",
        json={
            "consent": True,
            "face_name": "My face",
            "train_video_url": "https://example.com/face.webm",
        },
    )
    assert face.status_code == 200
    assert face.json()["face_id"] == "face_personal_123"

    monkeypatch.setattr(
        app_module.personalization,
        "create_personal_pal",
        lambda face_id, voice_id: {"pal_id": "pal_personal_123", "pal_name": "Personal"},
    )
    pal = client.post(
        "/api/personalization/pal",
        json={"face_id": "face_personal_123", "voice_id": "voice_personal_123"},
    )
    assert pal.status_code == 200
    assert pal.json()["pal_id"] == "pal_personal_123"


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

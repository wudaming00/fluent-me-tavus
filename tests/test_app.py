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
    assert "PERSONAL ENGLISH COACH" in response.text
    assert "Speak English with a coach who listens." in response.text
    assert "Start conversation" in response.text
    assert ">History<" in response.text
    assert "No video room or API credits used" in response.text
    assert "Live personal English coach" in response.text
    assert "Improve my wording" in response.text
    assert "How did I come across?" in response.text
    assert "Hear it. Try it. Compare." in response.text
    assert "Compare attempts" in response.text
    assert "Refresh session recap" in response.text
    assert "Review my English" in response.text
    assert "latest 12 learner turns" in response.text
    assert 'id="recap-card"' in response.text
    assert "Create your coach" in response.text
    assert 'id="personalization-dialog"' in response.text
    assert "/static/personalize.js" in response.text
    assert 'id="practice-panel"' in response.text
    assert 'id="log-panel"' in response.text
    assert "tavus-coach-preview.png" not in response.text
    assert "Your video coach will appear here" not in response.text
    assert "LET’S TALK" not in response.text
    assert 'id="open-feedback"' in response.text
    assert 'id="open-typing"' in response.text
    assert 'id="close-coach-console"' in response.text
    assert "id=\"tavus-video\"" in response.text
    assert "/static/daily-0.91.0.js" in response.text
    assert "/static/og-language-coach-v3.png" in response.text
    assert "unpkg.com" not in response.text
    assert "Hear the model" not in response.text
    assert "Match the rhythm" not in response.text
    assert "Say it from memory" not in response.text
    assert "Put it in context" not in response.text
    assert "Tavus interview English" not in response.text
    assert "digital face" not in response.text
    assert ">TAVUS<" not in response.text
    assert not re.search(r"[\u4e00-\u9fff]", response.text)
    assert "speaking evidence" in response.text.lower()
    assert "No mystery score" in response.text
    assert "/static/analysis-core.js" in response.text
    assert "/static/speech-signal.js" in response.text
    assert "/static/learning-memory.js" in response.text
    assert "LEARNING MEMORY" in response.text
    assert "Save for later" in response.text
    assert "Saved on this device; no recordings or full transcripts" in response.text
    assert "VOICE DETAILS" in response.text
    assert "Camera &amp; signal settings" in response.text
    assert "Kai" not in response.text
    assert "/static/live.js" in response.text
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["content-security-policy"] == "frame-ancestors 'none'"


def test_daily_sdk_is_served_from_the_same_origin():
    response = client.get("/static/daily-0.91.0.js")
    assert response.status_code == 200
    assert "DailyIframe" in response.text


def test_speech_signal_module_is_served_from_the_same_origin():
    response = client.get("/static/speech-signal.js")
    assert response.status_code == 200
    assert "FluentMeSpeechSignal" in response.text


def test_learning_memory_module_is_served_from_the_same_origin():
    response = client.get("/static/learning-memory.js")
    assert response.status_code == 200
    assert "FluentMeLearningMemory" in response.text
    assert "confirmation_required" in response.text
    assert "window.localStorage" not in response.text


def test_speech_capture_worklet_is_served_from_the_same_origin():
    response = client.get("/static/speech-capture-worklet.js")
    assert response.status_code == 200
    assert "fluent-me-speech-capture" in response.text


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
    assert "captureLearningTurn" in response.text
    assert "startDueRecall" in response.text
    assert "savePracticeTarget" in response.text
    assert "buildRecallPrompt" in response.text
    assert "recordReviewExpected" in response.text
    assert "window.navigator?.locks" in response.text
    assert "if (learningCaptureMode()) captureLearningTurn(turn)" in response.text
    assert "captureTypedLearningTurn" in response.text
    assert "preserveLearningResult" in response.text
    assert 'name !== "practice"' in response.text
    assert "normalizeLearningAfterDisconnect" in response.text
    assert "clearPersistedLearningMemory" in response.text
    assert "canStartLearningRecall" in response.text
    assert "coachSpeechStarted" in response.text
    assert "coachSpeechKeys" in response.text
    assert "learning-recall-text-form" in response.text
    assert "Transcript received; no timing" in response.text
    assert "createCallObject" in response.text
    assert "persistentTrack" in response.text
    assert "startAudioOff: true" in response.text
    assert "startVideoOff: true" in response.text
    assert "setLocalAudio" in response.text
    assert "setLocalVideo" in response.text
    assert "audioSource: false" not in response.text
    assert "videoSource: false" not in response.text
    assert "createFrame" not in response.text
    assert "Listen, Repeat, Fix, Recall, and Use" not in response.text
    assert "labelled evidence" in response.text
    assert "strongFillers" in response.text
    assert "rememberStop" in response.text
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
    assert response.json()["elevenlabs"]["voice_remixing_configured"] is True
    assert response.json()["elevenlabs"]["voice_remixing_availability"] == "unknown"
    assert response.json()["elevenlabs"]["voice_remixing_available"] is None
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


def test_voice_remix_preview_and_save_require_consent_and_return_safe_shapes(monkeypatch):
    denied = client.post(
        "/api/personalization/voice/remix",
        json={"voice_id": "voice_personal_123", "consent": False},
    )
    assert denied.status_code == 400

    seen = {}

    def fake_remix(voice_id, *, target_accent, strength, text):
        seen.update(
            voice_id=voice_id,
            target_accent=target_accent,
            strength=strength,
            text=text,
        )
        return {
            "source_voice_id": voice_id,
            "original_preserved": True,
            "target_accent": target_accent,
            "text": "preview text",
            "previews": [{
                "strength": strength,
                "generated_voice_id": "generated_medium_123",
                "audio_base_64": "YXVkaW8=",
                "media_type": "audio/mpeg",
            }],
        }

    monkeypatch.setattr(app_module.personalization, "remix_eleven_voice", fake_remix)
    preview = client.post(
        "/api/personalization/voice/remix",
        json={
            "voice_id": "voice_personal_123",
            "target_accent": "modern_british",
            "strength": "medium",
            "consent": True,
        },
    )
    assert preview.status_code == 200
    assert preview.json()["original_preserved"] is True
    assert seen["target_accent"] == "modern_british"

    def fake_save(preview_handle, *, name, played_not_selected_voice_ids):
        assert preview_handle == "signed-preview-handle"
        return {
            "voice_id": "voice_future_123",
            "name": name,
            "source": "remix",
            "original_preserved": True,
        }

    monkeypatch.setattr(app_module.personalization, "save_eleven_remix", fake_save)
    saved = client.post(
        "/api/personalization/voice/remix/save",
        json={
            "preview_handle": "signed-preview-handle",
            "generated_voice_id": "generated_attacker_claim_123",
            "voice_id": "voice_attacker_claim_123",
            "name": "Future Me",
            "consent": True,
        },
    )
    assert saved.status_code == 200
    assert saved.json()["voice_id"] == "voice_future_123"
    assert saved.json()["source"] == "remix"


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


def test_failed_remote_end_is_sanitized_and_remains_retryable(monkeypatch):
    conversation_id = "c-end-retry"
    app_module.TAVUS_SESSIONS[conversation_id] = {
        "conversation_id": conversation_id,
        "focus": "conversation",
        "topic": "",
        "started_at": 0,
        "events": [],
        "local_order": 0,
        "seen": set(),
        "processing": set(),
        "turn_results": {},
        "turns": [],
        "xp_gained": 0,
        "cards_created": 0,
        "cards_advanced": 0,
        "new_patterns": [],
        "advanced_patterns": [],
        "report_status": "live",
        # Avoid starting a real background finalizer in this unit test.
        "finalize_started": True,
        "remote_ended": False,
    }
    calls = []

    def flaky_end(value):
        calls.append(value)
        if len(calls) == 1:
            raise app_module.tavus.TavusAPIError(
                500, "provider leaked signed-url=private-token"
            )

    monkeypatch.setattr(app_module.tavus, "end_conversation", flaky_end)
    try:
        first = client.post(f"/api/tavus/conversations/{conversation_id}/end")
        assert first.status_code == 200
        assert first.json()["remote_warning"] == (
            "The video room may still be active. Try ending the session again."
        )
        assert "private-token" not in first.text
        assert app_module.TAVUS_SESSIONS[conversation_id]["remote_ended"] is False

        second = client.post(f"/api/tavus/conversations/{conversation_id}/end")
        assert second.status_code == 200
        assert len(calls) == 2
        assert app_module.TAVUS_SESSIONS[conversation_id]["remote_ended"] is True
    finally:
        app_module.TAVUS_SESSIONS.pop(conversation_id, None)

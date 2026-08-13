import io
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import personalization  # noqa: E402


class FakeResponse:
    def __init__(self, payload=None):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        if self.payload is None:
            return b""
        return json.dumps(self.payload).encode("utf-8")


def lower_headers(request):
    return {key.lower(): value for key, value in request.header_items()}


def test_eleven_subscription_is_sanitized_and_key_stays_in_header(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-server-secret")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        seen["timeout"] = timeout
        return FakeResponse({
            "tier": "creator",
            "character_count": 1200,
            "character_limit": 100_000,
            "voice_slots_used": 2,
            "voice_limit": 30,
            "can_use_instant_voice_cloning": True,
            "status": "active",
            "next_character_count_reset_unix": 1_800_000_000,
            "xi_api_key": "provider-echoed-secret",
            "open_invoices": [{"amount_due_cents": 999}],
        })

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)
    result = personalization.get_eleven_subscription()

    request = seen["request"]
    assert request.get_method() == "GET"
    assert request.full_url == "https://api.elevenlabs.io/v1/user/subscription"
    assert lower_headers(request)["xi-api-key"] == "eleven-server-secret"
    assert set(result) == {
        "tier",
        "character_count",
        "character_limit",
        "voice_slots_used",
        "voice_limit",
        "can_use_instant_voice_cloning",
        "status",
        "next_character_count_reset_unix",
    }
    assert result["character_limit"] == 100_000
    assert "secret" not in json.dumps(result)
    assert "open_invoices" not in result


def test_eleven_configured_uses_server_environment(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert personalization.eleven_configured() is False
    monkeypatch.setenv("ELEVENLABS_API_KEY", "  configured  ")
    assert personalization.eleven_configured() is True


def test_create_voice_uses_multipart_and_returns_only_clone_metadata(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-server-secret")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        seen["timeout"] = timeout
        return FakeResponse({
            "voice_id": "voice_abc123",
            "requires_verification": False,
            "private_provider_field": "do-not-return",
        })

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)
    result = personalization.create_eleven_voice(
        "My voice", b"\x00webm-audio\xff", "my voice.webm", "audio/webm"
    )

    request = seen["request"]
    headers = lower_headers(request)
    body = request.data
    assert request.get_method() == "POST"
    assert request.full_url == "https://api.elevenlabs.io/v1/voices/add"
    assert headers["xi-api-key"] == "eleven-server-secret"
    assert headers["content-type"].startswith("multipart/form-data; boundary=")
    assert b'name="name"' in body
    assert b"My voice" in body
    assert b'name="files"; filename="my_voice.webm"' in body
    assert b"Content-Type: audio/webm" in body
    assert b"\x00webm-audio\xff" in body
    assert b"eleven-server-secret" not in body
    assert result == {"voice_id": "voice_abc123", "requires_verification": False}


def test_create_voice_validates_name_type_and_file_limit(monkeypatch):
    monkeypatch.setattr(personalization, "MAX_VOICE_SAMPLE_BYTES", 3)
    with pytest.raises(ValueError, match="non-empty"):
        personalization.create_eleven_voice("Voice", b"")
    with pytest.raises(ValueError, match="20 MB"):
        personalization.create_eleven_voice("Voice", b"1234")
    with pytest.raises(ValueError, match="between 1 and 100"):
        personalization.create_eleven_voice("x" * 101, b"123")
    with pytest.raises(ValueError, match="control"):
        personalization.create_eleven_voice("Voice\r\nInjected", b"123")
    with pytest.raises(ValueError, match="MIME"):
        personalization.create_eleven_voice("Voice", b"123", content_type="audio/webm\r\nx: y")


@pytest.mark.parametrize(
    "url",
    [
        "http://cdn.example.com/training.mp4",
        "https://localhost/training.mp4",
        "https://studio.local/training.mp4",
        "https://127.0.0.1/training.mp4",
        "https://10.1.2.3/training.mp4",
        "https://169.254.1.2/training.mp4",
        "https://[::1]/training.mp4",
        "https://user:password@cdn.example.com/training.mp4",
    ],
)
def test_face_training_rejects_non_public_urls(url):
    with pytest.raises(ValueError):
        personalization.create_tavus_face("My face", url)


def test_create_face_uses_phoenix_4_and_server_header(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "tavus-server-secret")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        return FakeResponse({"face_id": "face_abc123", "status": "started", "extra": True})

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)
    result = personalization.create_tavus_face(
        "My Phoenix face",
        "https://uploads.example.com/training.mp4?signature=abc",
        "https://fluent.example.com/api/face-ready",
    )

    request = seen["request"]
    headers = lower_headers(request)
    payload = json.loads(request.data)
    assert request.get_method() == "POST"
    assert request.full_url == "https://tavusapi.com/v2/faces"
    assert headers["x-api-key"] == "tavus-server-secret"
    assert payload == {
        "face_name": "My Phoenix face",
        "train_video_url": "https://uploads.example.com/training.mp4?signature=abc",
        "model_name": "phoenix-4",
        "callback_url": "https://fluent.example.com/api/face-ready",
    }
    assert "tavus-server-secret" not in request.data.decode("utf-8")
    assert result == {"face_id": "face_abc123", "status": "started"}


def test_get_face_validates_id_and_sanitizes_response(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "tavus-server-secret")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        return FakeResponse({
            "face_id": "face_abc123",
            "face_name": "My face",
            "status": "completed",
            "training_progress": "100/100",
            "model_name": "phoenix-4",
            "internal": "not-for-browser",
        })

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)
    result = personalization.get_tavus_face("face_abc123")

    assert seen["request"].full_url == "https://tavusapi.com/v2/faces/face_abc123"
    assert result["status"] == "completed"
    assert result["model_name"] == "phoenix-4"
    assert "internal" not in result
    with pytest.raises(ValueError, match="face_id"):
        personalization.get_tavus_face("../faces/other")


def test_personal_pal_combines_phoenix_eleven_raven_and_sparrow(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "tavus-server-secret")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-server-secret")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        return FakeResponse({"pal_id": "pal_abc123", "pal_name": "Created coach"})

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)
    result = personalization.create_personal_pal("face_abc123", "voice_abc123")

    request = seen["request"]
    headers = lower_headers(request)
    payload = json.loads(request.data)
    layers = payload["layers"]
    assert request.get_method() == "POST"
    assert request.full_url == "https://tavusapi.com/v2/pals"
    assert headers["x-api-key"] == "tavus-server-secret"
    assert payload["pipeline_mode"] == "full"
    assert payload["default_face_id"] == "face_abc123"
    assert payload["pal_name"].startswith("Fluent Me Personal Coach ")
    assert layers["perception"]["perception_model"] == "raven-1"
    assert layers["perception"]["emotion_recognition"] == "limited"
    assert layers["conversational_flow"]["turn_detection_model"] == "sparrow-1"
    assert layers["tts"] == {
        "tts_engine": "elevenlabs",
        "api_key": "eleven-server-secret",
        "external_voice_id": "voice_abc123",
        "tts_model_name": "eleven_flash_v2_5",
        "tts_emotion_control": True,
        "voice_settings": {
            "speed": 0.95,
            "stability": 0.7,
            "similarity_boost": 0.8,
            "style": 0.1,
            "use_speaker_boost": True,
        },
    }
    assert "compare" in payload["system_prompt"].lower()
    assert "wrapping up" in payload["system_prompt"].lower()
    assert "only when camera input exists" in payload["system_prompt"]
    assert "tavus-server-secret" not in request.data.decode("utf-8")
    assert "secret" not in json.dumps(result)
    assert result == {"pal_id": "pal_abc123", "pal_name": "Created coach"}


@pytest.mark.parametrize("face_id,voice_id", [
    ("../face", "voice_abc123"),
    ("face_abc123", "voice/other"),
    ("ab", "voice_abc123"),
    ("face id", "voice_abc123"),
])
def test_personal_pal_rejects_unsafe_ids(face_id, voice_id):
    with pytest.raises(ValueError):
        personalization.create_personal_pal(face_id, voice_id)


def test_personal_pal_can_use_stock_face_for_voice_only_setup(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-server-secret")
    monkeypatch.setenv("TAVUS_API_KEY", "tavus-server-secret")
    monkeypatch.delenv("TAVUS_FACE_ID", raising=False)
    seen = {}

    def fake_urlopen(request, timeout):
        seen["payload"] = json.loads(request.data)
        return FakeResponse({"pal_id": "pal_voice_only_123", "pal_name": "Voice only"})

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)

    result = personalization.create_personal_pal("", "voice_abc123")

    assert seen["payload"]["default_face_id"] == personalization.DEFAULT_FACE_ID
    assert result["pal_id"] == "pal_voice_only_123"


@pytest.mark.parametrize(
    "status,expected",
    [
        (401, "credential"),
        (403, "credential"),
        (402, "credits"),
        (429, "rate or concurrency"),
        (422, "recording or configuration"),
    ],
)
def test_provider_errors_are_actionable_and_do_not_echo_secrets(monkeypatch, status, expected):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-server-secret")

    def fake_urlopen(request, timeout):
        raw = json.dumps({"detail": {"message": "failed eleven-server-secret"}}).encode()
        raise personalization.urllib.error.HTTPError(
            request.full_url, status, "failure", {}, io.BytesIO(raw)
        )

    monkeypatch.setattr(personalization.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(personalization.PersonalizationAPIError) as error:
        personalization.get_eleven_subscription()

    assert error.value.status == status
    assert expected in str(error.value)
    assert "eleven-server-secret" not in str(error.value)

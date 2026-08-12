import io
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import tavus  # noqa: E402


def test_default_face_is_nathan_bookshelf():
    assert tavus.DEFAULT_FACE_ID == "r987f6e6f73c"


class FakeResponse:
    def __init__(self, payload=None):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode() if self.payload is not None else b""


def test_status_requires_server_key(monkeypatch):
    monkeypatch.delenv("TAVUS_API_KEY", raising=False)
    assert tavus.configured() is False
    with pytest.raises(tavus.TavusAPIError) as error:
        tavus._request("GET", "/faces")
    assert error.value.status == 503


def test_create_conversation_is_private_and_does_not_expose_key(monkeypatch, tmp_path):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    monkeypatch.setenv("TAVUS_PAL_ID", "pal-existing")
    monkeypatch.delenv("TAVUS_FACE_ID", raising=False)
    seen = {}

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["headers"] = dict(request.header_items())
        seen["body"] = json.loads(request.data)
        return FakeResponse({
            "conversation_id": "c-live",
            "conversation_url": "https://tavus.daily.co/c-live",
            "meeting_token": "short-lived-token",
            "status": "active",
        })

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    result = tavus.create_conversation("learner context", "Hey there", "interview")

    assert seen["url"].endswith("/v2/conversations")
    assert seen["headers"]["X-api-key"] == "server-secret"
    assert seen["body"]["require_auth"] is True
    assert seen["body"]["max_participants"] == 2
    assert seen["body"]["pal_id"] == "pal-existing"
    assert seen["body"]["face_id"] == tavus.DEFAULT_FACE_ID
    assert "server-secret" not in json.dumps(result)
    assert result["meeting_token"] == "short-lived-token"


def test_auto_pal_uses_raven_sparrow_and_limited_emotion(monkeypatch, tmp_path):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    monkeypatch.delenv("TAVUS_PAL_ID", raising=False)
    monkeypatch.delenv("TAVUS_FACE_ID", raising=False)
    monkeypatch.setattr(tavus, "CACHE_FILE", tmp_path / "tavus_pal.json")
    requests = []

    def fake_urlopen(request, timeout):
        body = json.loads(request.data) if request.data else None
        requests.append((request.get_method(), request.full_url, body))
        return FakeResponse({"pal_id": "pal-created"})

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    pal_id, source = tavus.ensure_pal()
    pal_payload = requests[-1][2]

    assert (pal_id, source) == ("pal-created", "created")
    assert pal_payload["pipeline_mode"] == "full"
    assert pal_payload["default_face_id"] == tavus.DEFAULT_FACE_ID
    assert pal_payload["layers"]["perception"]["perception_model"] == "raven-1"
    assert pal_payload["layers"]["perception"]["emotion_recognition"] == "limited"
    assert pal_payload["layers"]["conversational_flow"]["turn_detection_model"] == "sparrow-1"
    assert "tts" not in pal_payload["layers"]
    assert "Kai" not in pal_payload["pal_name"]
    assert "Kai" not in pal_payload["system_prompt"]


def test_face_override_applies_to_existing_pal(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    monkeypatch.setenv("TAVUS_PAL_ID", "pal-existing")
    monkeypatch.setenv("TAVUS_FACE_ID", "face-custom-male")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["body"] = json.loads(request.data)
        return FakeResponse({
            "conversation_id": "c-live",
            "conversation_url": "https://tavus.daily.co/c-live",
            "meeting_token": "short-lived-token",
        })

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    tavus.create_conversation("context", "Hello")

    assert seen["body"]["pal_id"] == "pal-existing"
    assert seen["body"]["face_id"] == "face-custom-male"


def test_default_male_face_overrides_cached_pal(monkeypatch, tmp_path):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    monkeypatch.delenv("TAVUS_PAL_ID", raising=False)
    monkeypatch.delenv("TAVUS_FACE_ID", raising=False)
    cache_file = tmp_path / "tavus_pal.json"
    cache_file.write_text(json.dumps({
        "schema": 2,
        "pal_id": "pal-with-old-female-default",
        "face_id": "old-female-face",
    }), encoding="utf-8")
    monkeypatch.setattr(tavus, "CACHE_FILE", cache_file)
    seen = {}

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["body"] = json.loads(request.data)
        return FakeResponse({
            "conversation_id": "c-live",
            "conversation_url": "https://tavus.daily.co/c-live",
            "meeting_token": "short-lived-token",
        })

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    tavus.create_conversation("context", "Hello")

    assert seen["url"].endswith("/v2/conversations")
    assert seen["body"]["pal_id"] == "pal-with-old-female-default"
    assert seen["body"]["face_id"] == tavus.DEFAULT_FACE_ID


def test_end_conversation_uses_end_endpoint(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    seen = {}

    def fake_urlopen(request, timeout):
        seen["method"] = request.get_method()
        seen["url"] = request.full_url
        return FakeResponse(None)

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    tavus.end_conversation("c-safe")
    assert seen["method"] == "POST"
    assert seen["url"].endswith("/v2/conversations/c-safe/end")

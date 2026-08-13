import io
import json
import socket
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
    monkeypatch.setenv("TAVUS_CONVERSATION_PAL_V5_ID", "pal-existing")
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
    assert seen["body"]["properties"] == {
        "participant_absent_timeout": 60,
        "participant_left_timeout": 15,
        "max_call_duration": 900,
    }
    assert seen["body"]["pal_id"] == "pal-existing"
    assert seen["body"]["face_id"] == tavus.DEFAULT_FACE_ID
    assert "server-secret" not in json.dumps(result)
    assert result["meeting_token"] == "short-lived-token"


def test_auto_pal_uses_raven_sparrow_and_limited_emotion(monkeypatch, tmp_path):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    monkeypatch.delenv("TAVUS_CONVERSATION_PAL_V5_ID", raising=False)
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
    assert pal_payload["pal_name"] == "Fluent Me Conversation Coach v5"
    assert "live, learner-led conversation" in pal_payload["system_prompt"]
    assert "inner emotion" in pal_payload["system_prompt"]
    assert "compare two attempts" in pal_payload["system_prompt"]
    assert "compact session reflection" in pal_payload["system_prompt"]
    assert "tts" not in pal_payload["layers"]
    assert "Kai" not in pal_payload["pal_name"]
    assert "Kai" not in pal_payload["system_prompt"]


def test_face_override_applies_to_existing_pal(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")
    monkeypatch.setenv("TAVUS_CONVERSATION_PAL_V5_ID", "pal-existing")
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
    monkeypatch.delenv("TAVUS_CONVERSATION_PAL_V5_ID", raising=False)
    monkeypatch.delenv("TAVUS_FACE_ID", raising=False)
    cache_file = tmp_path / "tavus_pal.json"
    cache_file.write_text(json.dumps({
        "schema": 4,
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


def test_payment_required_has_actionable_message(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")

    def fake_urlopen(request, timeout):
        raise tavus.urllib.error.HTTPError(
            request.full_url, 402, "Payment Required", {}, io.BytesIO(b'{}')
        )

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(tavus.TavusAPIError) as error:
        tavus._request("GET", "/faces")

    assert error.value.status == 402
    assert "conversation minutes" in str(error.value)


def test_tavus_timeout_maps_to_safe_gateway_timeout(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")

    def fake_urlopen(request, timeout):
        raise socket.timeout("timeout included server-secret")

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(tavus.TavusAPIError) as error:
        tavus._request("GET", "/faces")

    assert error.value.status == 504
    assert str(error.value) == "Tavus did not respond in time. Try again."
    assert "server-secret" not in str(error.value)


def test_tavus_generic_provider_error_does_not_reflect_raw_body(monkeypatch):
    monkeypatch.setenv("TAVUS_API_KEY", "server-secret")

    def fake_urlopen(request, timeout):
        raw = b'{"message":"signed-url=private-token server-secret"}'
        raise tavus.urllib.error.HTTPError(
            request.full_url, 500, "failure", {}, io.BytesIO(raw)
        )

    monkeypatch.setattr(tavus.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(tavus.TavusAPIError) as error:
        tavus._request("GET", "/faces")

    assert error.value.status == 500
    assert str(error.value) == "Tavus could not complete that request. Try again."
    assert "private-token" not in str(error.value)
    assert "server-secret" not in str(error.value)


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

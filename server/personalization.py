"""Server-only helpers for Fluent Me face and voice personalization.

The browser should send recordings and public training URLs to Fluent Me's
backend.  Only this module talks to ElevenLabs and Tavus, so neither provider
credential is ever returned to client code.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


ELEVEN_API_BASE = "https://api.elevenlabs.io/v1"
TAVUS_API_BASE = "https://tavusapi.com/v2"
DEFAULT_FACE_ID = "r987f6e6f73c"
MAX_VOICE_SAMPLE_BYTES = 20 * 1024 * 1024
MAX_NAME_LENGTH = 100
ALLOWED_VOICE_MIME_TYPES = frozenset(
    {
        "audio/aac",
        "audio/flac",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "audio/x-m4a",
        "audio/x-wav",
    }
)

_SAFE_ID = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9_-]{5,127}\Z")
_SUBSCRIPTION_FIELDS = (
    "tier",
    "character_count",
    "character_limit",
    "voice_slots_used",
    "voice_limit",
    "can_use_instant_voice_cloning",
    "status",
    "next_character_count_reset_unix",
)
_FACE_FIELDS = (
    "face_id",
    "face_name",
    "status",
    "training_progress",
    "error_message",
    "model_name",
    "created_at",
    "updated_at",
)


class PersonalizationAPIError(RuntimeError):
    """A provider failure safe enough to map to an HTTP response."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def eleven_configured() -> bool:
    """Return whether the server has an ElevenLabs credential."""

    return bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())


def _provider_key(provider: str) -> str:
    env_name = "ELEVENLABS_API_KEY" if provider == "ElevenLabs" else "TAVUS_API_KEY"
    key = os.environ.get(env_name, "").strip()
    if not key:
        raise PersonalizationAPIError(503, f"{provider} is not configured on this server.")
    return key


def _redact_secrets(message: str) -> str:
    safe = message
    for env_name in ("ELEVENLABS_API_KEY", "TAVUS_API_KEY"):
        secret = os.environ.get(env_name, "").strip()
        if secret:
            safe = safe.replace(secret, "[redacted]")
    return safe[:240]


def _response_message(raw: bytes) -> str:
    try:
        body = json.loads(raw.decode("utf-8", errors="replace"))
    except (UnicodeError, ValueError):
        return ""
    if not isinstance(body, dict):
        return ""
    candidates: list[Any] = [body.get("message"), body.get("error")]
    detail = body.get("detail")
    if isinstance(detail, dict):
        candidates.extend((detail.get("message"), detail.get("error")))
    elif isinstance(detail, str):
        candidates.append(detail)
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return _redact_secrets(candidate.strip())
    return ""


def _friendly_error(provider: str, status: int, raw: bytes) -> str:
    if status in (401, 403):
        return f"{provider} rejected the server credential. Check or rotate its API key."
    if status == 402:
        return f"The {provider} account needs more credits before personalization can continue."
    if status == 429:
        return f"{provider} is at its current rate or concurrency limit. Try again shortly."
    if status == 422:
        return (
            f"{provider} could not use the submitted recording or configuration. "
            "Check the media and try again."
        )
    # Provider response text is not part of our public API. It can contain
    # signed media URLs, account metadata, or other configuration details.
    return f"{provider} could not complete that request. Try again."


def _request_json(
    provider: str,
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: int = 45,
) -> dict[str, Any]:
    key = _provider_key(provider)
    key_header = "xi-api-key" if provider == "ElevenLabs" else "x-api-key"
    headers = {key_header: key, "accept": "application/json"}
    if content_type:
        headers["content-type"] = content_type
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        raise PersonalizationAPIError(
            exc.code, _friendly_error(provider, exc.code, raw)
        ) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise PersonalizationAPIError(
            504, f"{provider} did not respond in time. Try again."
        ) from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise PersonalizationAPIError(
                504, f"{provider} did not respond in time. Try again."
            ) from exc
        raise PersonalizationAPIError(
            502, f"Could not reach {provider} from the server."
        ) from exc

    if not raw:
        return {}
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise PersonalizationAPIError(
            502, f"{provider} returned an unreadable response."
        ) from exc
    if not isinstance(result, dict):
        raise PersonalizationAPIError(
            502, f"{provider} returned an unexpected response."
        )
    return result


def _json_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _safe_name(value: str, field: str = "name") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text.")
    clean = value.strip()
    if not clean or len(clean) > MAX_NAME_LENGTH:
        raise ValueError(f"{field} must be between 1 and {MAX_NAME_LENGTH} characters.")
    if any(ord(character) < 32 or ord(character) == 127 for character in clean):
        raise ValueError(f"{field} cannot contain control characters.")
    return clean


def _safe_id(value: str, field: str) -> str:
    if not isinstance(value, str) or not _SAFE_ID.fullmatch(value):
        raise ValueError(
            f"{field} must be 3-128 characters using only letters, numbers, '_' or '-'."
        )
    return value


def _safe_filename(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("filename must be text.")
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", value.strip())[:180]
    clean = clean.lstrip(".")
    if not clean:
        raise ValueError("filename must include at least one safe character.")
    return clean


def _public_https_url(value: str, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an HTTPS URL.")
    clean = value.strip()
    try:
        parsed = urllib.parse.urlsplit(clean)
        # Accessing port also catches malformed or out-of-range port syntax.
        parsed.port
    except ValueError as exc:
        raise ValueError(f"{field} must be a valid HTTPS URL.") from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError(f"{field} must be a public HTTPS URL.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(f"{field} cannot contain credentials.")
    hostname = parsed.hostname.rstrip(".").lower()
    if (
        hostname == "localhost"
        or hostname.endswith(".localhost")
        or hostname.endswith(".local")
        or hostname.endswith(".internal")
        or hostname.endswith(".home.arpa")
        or "%" in hostname
    ):
        raise ValueError(f"{field} must use a public host.")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError(f"{field} cannot use a private or local IP address.")
    return clean


def get_eleven_subscription() -> dict[str, Any]:
    """Return the billing/voice-slot subset safe for the browser to display."""

    result = _request_json(
        "ElevenLabs", "GET", f"{ELEVEN_API_BASE}/user/subscription"
    )
    return {field: result.get(field) for field in _SUBSCRIPTION_FIELDS}


def create_eleven_voice(
    name: str,
    audio_bytes: bytes,
    filename: str = "voice.webm",
    content_type: str = "audio/webm",
) -> dict[str, Any]:
    """Create an ElevenLabs instant voice clone from one recorded sample."""

    safe_name = _safe_name(name, "voice name")
    if not isinstance(audio_bytes, (bytes, bytearray, memoryview)):
        raise ValueError("audio_bytes must contain binary audio data.")
    sample = bytes(audio_bytes)
    if not sample:
        raise ValueError("A non-empty voice recording is required.")
    if len(sample) > MAX_VOICE_SAMPLE_BYTES:
        raise ValueError("Voice recordings must be 20 MB or smaller.")
    safe_filename = _safe_filename(filename)
    safe_content_type = (
        content_type.split(";", 1)[0].strip().lower()
        if isinstance(content_type, str)
        else ""
    )
    if safe_content_type not in ALLOWED_VOICE_MIME_TYPES:
        raise ValueError("content_type must be a supported audio MIME type.")

    boundary = f"----FluentMe{secrets.token_hex(16)}"
    body = bytearray()

    def add(value: bytes) -> None:
        body.extend(value)

    add(f"--{boundary}\r\n".encode("ascii"))
    add(b'Content-Disposition: form-data; name="name"\r\n\r\n')
    add(safe_name.encode("utf-8"))
    add(b"\r\n")
    add(f"--{boundary}\r\n".encode("ascii"))
    add(
        (
            'Content-Disposition: form-data; name="files"; '
            f'filename="{safe_filename}"\r\n'
        ).encode("ascii")
    )
    add(f"Content-Type: {safe_content_type}\r\n\r\n".encode("ascii"))
    add(sample)
    add(b"\r\n")
    add(f"--{boundary}--\r\n".encode("ascii"))

    result = _request_json(
        "ElevenLabs",
        "POST",
        f"{ELEVEN_API_BASE}/voices/add",
        data=bytes(body),
        content_type=f"multipart/form-data; boundary={boundary}",
        timeout=90,
    )
    voice_id = result.get("voice_id")
    if not isinstance(voice_id, str) or not _SAFE_ID.fullmatch(voice_id):
        raise PersonalizationAPIError(502, "ElevenLabs created no usable voice identifier.")
    return {
        "voice_id": voice_id,
        "requires_verification": bool(result.get("requires_verification", False)),
    }


def create_tavus_face(
    face_name: str, train_video_url: str, callback_url: str = ""
) -> dict[str, Any]:
    """Start Phoenix-4 face training from a public video owned by the user."""

    payload: dict[str, Any] = {
        "face_name": _safe_name(face_name, "face name"),
        "train_video_url": _public_https_url(train_video_url, "train_video_url"),
        "model_name": "phoenix-4",
    }
    if callback_url:
        payload["callback_url"] = _public_https_url(callback_url, "callback_url")
    result = _request_json(
        "Tavus",
        "POST",
        f"{TAVUS_API_BASE}/faces",
        data=_json_body(payload),
        content_type="application/json",
        timeout=90,
    )
    face_id = result.get("face_id")
    if not isinstance(face_id, str) or not _SAFE_ID.fullmatch(face_id):
        raise PersonalizationAPIError(502, "Tavus created no usable face identifier.")
    return {"face_id": face_id, "status": result.get("status")}


def get_tavus_face(face_id: str) -> dict[str, Any]:
    """Read a Phoenix face training status without exposing the Tavus key."""

    safe_face_id = _safe_id(face_id, "face_id")
    result = _request_json(
        "Tavus", "GET", f"{TAVUS_API_BASE}/faces/{safe_face_id}"
    )
    safe_result = {field: result.get(field) for field in _FACE_FIELDS}
    if result.get("error_message") or result.get("error_details"):
        safe_result["error_message"] = (
            "Tavus could not train this video. Check the recording and try again."
        )
    return safe_result


PERSONAL_COACH_PROMPT = """You are the visible personal English coach inside Fluent Me. This is a
live, learner-led conversation, not a scripted lesson. Respond to what the learner means first.
Keep most replies to one to three natural spoken sentences and ask at most one useful follow-up.
The learner may change topics, interrupt, or ask a direct question at any time. Never force a
curriculum sequence. You are an AI English coach, not a human, therapist, examiner, or evaluator.

When the learner asks how they sounded, give exactly one specific English observation and one more
natural version of their last completed thought. Do not give a numeric score or a wall of metrics.
When they ask you to model a phrase, speak the improved version clearly and invite one retry. Exact
model phrases delivered through conversation.echo must be spoken exactly.

When asked to compare two attempts, use only the supplied transcripts and observable audio or visual
signals. Name one concrete improvement first, then one next detail to practice, and finish by
speaking the strongest version once. Never invent an attempt, signal, or score. If either attempt
is missing, say what is missing.

When wrapping up, give exactly three compact parts grounded in this conversation: one thing the
learner communicated well, one useful natural phrase from the session, and one specific thing to
practice next.

When asked about emotion, presence, or how the learner comes across, use only cues actually
available in the current turn: words, pace, pauses, clarity, vocal tone, and visible delivery cues
only when camera input exists. Cite the cue, state uncertainty, and ask if the impression matches
their experience. Never claim to know an inner emotion, diagnose a mental state, or infer ability,
personality, or protected traits. If a modality is unavailable or evidence is weak, say so plainly.

Be warm, direct, curious, and appropriate for an intermediate English learner."""


def create_personal_pal(face_id: str, voice_id: str) -> dict[str, Any]:
    """Create a full Tavus PAL using the learner's Phoenix face and Eleven voice."""

    safe_face_id = _safe_id(
        face_id or os.environ.get("TAVUS_FACE_ID", "").strip() or DEFAULT_FACE_ID,
        "face_id",
    )
    safe_voice_id = _safe_id(voice_id, "voice_id")
    eleven_key = _provider_key("ElevenLabs")
    # A suffix avoids collisions while keeping PAL Maker listings readable.
    pal_name = f"Fluent Me Personal Coach {int(time.time())}-{secrets.token_hex(3)}"
    payload: dict[str, Any] = {
        "pal_name": pal_name,
        "pipeline_mode": "full",
        "system_prompt": PERSONAL_COACH_PROMPT,
        "default_face_id": safe_face_id,
        "disclosure_type": "always",
        "verbal_disclosure": "Just so you know, you're speaking with an AI English coach.",
        "visual_disclosure": "You are speaking with an AI English coach.",
        "layers": {
            "perception": {
                "perception_model": "raven-1",
                "emotion_recognition": "limited",
                "visual_awareness_queries": [
                    "Describe only visible delivery cues relevant to this turn, such as gaze, posture, gesture, or expression changes. Do not label an inner emotion.",
                ],
                "audio_awareness_queries": [
                    "Describe only observable vocal delivery: pace, pauses, clarity, energy, volume changes, and background noise. Do not diagnose emotion.",
                ],
                "perception_analysis_queries": [
                    "Summarize observable delivery changes across the session, cite evidence, preserve uncertainty, and do not infer emotion or ability.",
                ],
            },
            "conversational_flow": {
                "turn_detection_model": "sparrow-1",
                "turn_taking_patience": "medium",
                "turn_commitment": "medium",
                "pal_interruptibility": "high",
                "voice_isolation": "near",
                "idle_engagement": "off",
            },
            "tts": {
                "tts_engine": "elevenlabs",
                "api_key": eleven_key,
                "external_voice_id": safe_voice_id,
                "tts_model_name": "eleven_flash_v2_5",
                "tts_emotion_control": True,
                "voice_settings": {
                    "speed": 0.95,
                    "stability": 0.7,
                    "similarity_boost": 0.8,
                    "style": 0.1,
                    "use_speaker_boost": True,
                },
            },
        },
    }
    result = _request_json(
        "Tavus",
        "POST",
        f"{TAVUS_API_BASE}/pals",
        data=_json_body(payload),
        content_type="application/json",
        timeout=90,
    )
    pal_id = result.get("pal_id")
    if not isinstance(pal_id, str) or not _SAFE_ID.fullmatch(pal_id):
        raise PersonalizationAPIError(502, "Tavus created no usable PAL identifier.")
    return {"pal_id": pal_id, "pal_name": result.get("pal_name") or pal_name}

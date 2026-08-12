"""Small, server-only Tavus CVI client for Fluent Me.

The browser never receives the Tavus API key. It only receives a private Daily
room URL and its short-lived meeting token. A PAL created by this module uses
Tavus' full pipeline: Raven perception, Sparrow turn-taking, and the Face's
default voice. Fluent Me's cloned learner voice remains a separate correction
channel so the tutor's face never speaks with the learner's identity.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


BASE = Path(__file__).resolve().parent.parent
CACHE_FILE = BASE / "data" / "tavus_pal_v4.json"
DEFAULT_API_BASE = "https://tavusapi.com/v2"
DEFAULT_FACE_ID = "r987f6e6f73c"  # Nathan - Bookshelf, account-available Phoenix-4 stock Face


class TavusAPIError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def configured() -> bool:
    return bool(os.environ.get("TAVUS_API_KEY", "").strip())


def _api_base() -> str:
    return os.environ.get("TAVUS_API_BASE", DEFAULT_API_BASE).rstrip("/")


def _friendly_error(status: int, raw: bytes) -> str:
    message = "Tavus request failed"
    try:
        body = json.loads(raw.decode("utf-8", errors="replace"))
        candidate = body.get("message") or body.get("error")
        if isinstance(candidate, str) and candidate.strip():
            message = candidate.strip()
    except (ValueError, AttributeError):
        pass
    if status in (401, 403):
        return "Tavus rejected the server credential. Rotate the key and try again."
    if status == 429:
        return "Tavus is at its current concurrency or rate limit. Try again shortly."
    return message[:240]


def _request(method: str, path: str, payload: dict | None = None,
             query: dict[str, Any] | None = None, timeout: int = 35) -> dict:
    key = os.environ.get("TAVUS_API_KEY", "").strip()
    if not key:
        raise TavusAPIError(503, "Tavus is not configured on this server.")
    url = f"{_api_base()}/{path.lstrip('/')}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"x-api-key": key, "accept": "application/json"}
    if payload is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        raise TavusAPIError(exc.code, _friendly_error(exc.code, raw)) from exc
    except urllib.error.URLError as exc:
        raise TavusAPIError(502, "Could not reach Tavus from the server.") from exc


def _cached_pal_id() -> str:
    try:
        cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if cached.get("schema") == 3:
            return str(cached.get("pal_id") or "")
    except (OSError, ValueError, AttributeError):
        pass
    return ""


def _save_pal_id(pal_id: str, face_id: str) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps({"schema": 3, "pal_id": pal_id,
                                      "face_id": face_id}, indent=2), encoding="utf-8")


def _select_face_id() -> str:
    return os.environ.get("TAVUS_FACE_ID", "").strip() or DEFAULT_FACE_ID


PAL_SYSTEM_PROMPT = """You are the visible personal English coach inside Fluent Me. This is a
live, learner-led conversation, not a scripted lesson. Respond to what the learner means first.
Keep most replies to one to three natural spoken sentences and ask at most one useful follow-up.
The learner may change topics, interrupt, or ask a direct question at any time. Never wait for an
app-controlled step and never force a curriculum sequence.

When the learner asks "How did I sound?", give exactly one specific English observation and one
more natural version of their last completed thought. Do not give a numeric score or a wall of
metrics. When they ask you to say something naturally, speak the improved version clearly and
invite them to try it. Exact model phrases may arrive through conversation.echo; say those exactly.

When the learner asks about emotion, presence, or how they are coming across, use only observable
signals that were actually available in the current turn: words, pace, pauses, clarity, vocal tone,
and visible delivery cues only when camera input exists. Cite the cue, state uncertainty, and ask
whether the impression matches their experience. Never claim to know an inner emotion, diagnose a
mental state, or infer ability, personality, or protected traits. If evidence is weak or a modality
is unavailable, say so plainly.

Be warm, direct, curious, and appropriate for an intermediate English learner. You are an AI
English coach, not a human, therapist, examiner, or hiring evaluator."""


def ensure_pal() -> tuple[str, str]:
    # A dedicated v4 variable prevents a previously configured scripted PAL
    # from silently bypassing the conversation-first prompt.
    explicit = os.environ.get("TAVUS_CONVERSATION_PAL_ID", "").strip()
    if explicit:
        return explicit, "configured"
    cached = _cached_pal_id()
    if cached:
        return cached, "cached"

    face_id = _select_face_id()
    payload = {
        "pal_name": "Fluent Me Conversation Coach v4",
        "pipeline_mode": "full",
        "system_prompt": PAL_SYSTEM_PROMPT,
        "default_face_id": face_id,
        "disclosure_type": "always",
        "verbal_disclosure": "Just so you know, you're speaking with an AI English coach.",
        "visual_disclosure": "You are speaking with an AI English coach.",
        "layers": {
            "perception": {
                "perception_model": "raven-1",
                "emotion_recognition": "limited",
                "visual_awareness_queries": [
                    "Describe only observable delivery cues relevant to this turn, such as gaze direction, posture, gesture, or visible expression changes. Do not label an inner emotion.",
                    "What visible object, screen, or activity is directly relevant to what the learner is saying?",
                ],
                "audio_awareness_queries": [
                    "Describe only observable vocal delivery in this turn: pace, pauses, clarity, energy, volume changes, and background noise. Do not diagnose an inner emotion.",
                ],
                "perception_analysis_queries": [
                    "Summarize observable delivery changes across the session, cite evidence, and preserve uncertainty without inferring emotion or ability.",
                    "What visible objects or shared-screen content became relevant to the conversation?",
                ],
            },
            "conversational_flow": {
                "turn_detection_model": "sparrow-1",
                "turn_taking_patience": "medium",
                "pal_interruptibility": "high",
                "voice_isolation": "near",
            },
        },
    }
    result = _request("POST", "/pals", payload=payload)
    pal_id = str(result.get("pal_id") or "")
    if not pal_id:
        raise TavusAPIError(502, "Tavus created no usable PAL identifier.")
    _save_pal_id(pal_id, face_id)
    return pal_id, "created"


def create_conversation(context: str, greeting: str, focus: str = "conversation") -> dict:
    pal_id, pal_source = ensure_pal()
    payload: dict[str, Any] = {
        "pal_id": pal_id,
        # A conversation-level Face wins over an older PAL default. This keeps
        # cached/configured PALs while making the visible coach deterministic.
        "face_id": _select_face_id(),
        "conversation_name": f"Fluent Me · {focus[:40]}",
        "conversational_context": context[:12_000],
        "custom_greeting": greeting[:500],
        "require_auth": True,
        "max_participants": 2,
        "audio_only": False,
    }
    callback_url = os.environ.get("TAVUS_CALLBACK_URL", "").strip()
    if callback_url:
        payload["callback_url"] = callback_url
    result = _request("POST", "/conversations", payload=payload)
    required = ("conversation_id", "conversation_url", "meeting_token")
    if any(not result.get(field) for field in required):
        raise TavusAPIError(502, "Tavus returned an incomplete private-room response.")
    result["pal_source"] = pal_source
    return result


def end_conversation(conversation_id: str) -> None:
    safe_id = urllib.parse.quote(conversation_id, safe="")
    _request("POST", f"/conversations/{safe_id}/end", payload=None)


def get_conversation(conversation_id: str, verbose: bool = False) -> dict:
    safe_id = urllib.parse.quote(conversation_id, safe="")
    query = {"verbose": "true"} if verbose else None
    return _request("GET", f"/conversations/{safe_id}", query=query)

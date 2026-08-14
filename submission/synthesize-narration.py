#!/usr/bin/env python3
"""Synthesize the demo narration chapters with an ElevenLabs voice.

Produces one "<key>-raw.wav" (24 kHz, 16-bit, mono PCM) per chapter for
build-demo-video.ps1 -PrebuiltVoiceDir. The narration text comes from the
build script itself so there is a single editorial source of truth:

  1) pwsh -File submission/build-demo-video.ps1 -ExportNarration submission/media/.narration.json
  2) python submission/synthesize-narration.py --narration submission/media/.narration.json \
         --out submission/media/.eleven-voice [--clone path/to/voice-sample.wav]
  3) pwsh -File submission/build-demo-video.ps1 -PrebuiltVoiceDir submission/media/.eleven-voice

Credentials are read from the repo .env (ELEVENLABS_API_KEY, optionally
ELEVEN_VOICE_ID). --clone creates an Instant Voice Clone from a 60-90 second
clean speech sample and prints the resulting voice_id; reuse it later via
--voice-id or ELEVEN_VOICE_ID instead of cloning again. The API key and the
voice sample are sent only to api.elevenlabs.io.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import pathlib
import sys
import urllib.error
import urllib.request
import uuid
import wave

API_BASE = "https://api.elevenlabs.io"
SAMPLE_RATE = 24_000


def load_env(env_path: pathlib.Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.is_file():
        return values
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def api_request(path: str, api_key: str, *, data: bytes | None = None,
                content_type: str | None = None, timeout: int = 120) -> bytes:
    request = urllib.request.Request(API_BASE + path, data=data)
    request.add_header("xi-api-key", api_key)
    request.add_header("accept", "*/*")
    if content_type:
        request.add_header("content-type", content_type)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        detail = error.read()[:600].decode("utf-8", "replace")
        raise SystemExit(f"ElevenLabs {error.code} on {path}: {detail}") from None


def create_instant_clone(api_key: str, sample: pathlib.Path, name: str) -> str:
    boundary = f"----fluentme{uuid.uuid4().hex}"
    mime = mimetypes.guess_type(sample.name)[0] or "application/octet-stream"
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n{name}\r\n".encode(),
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; "
         f"filename=\"{sample.name}\"\r\nContent-Type: {mime}\r\n\r\n").encode()
        + sample.read_bytes() + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    raw = api_request("/v1/voices/add", api_key, data=body,
                      content_type=f"multipart/form-data; boundary={boundary}", timeout=300)
    voice_id = str(json.loads(raw).get("voice_id") or "")
    if not voice_id:
        raise SystemExit(f"ElevenLabs returned no voice_id: {raw[:300]!r}")
    return voice_id


def synthesize_chapter(api_key: str, voice_id: str, model: str, text: str) -> bytes:
    payload = json.dumps({
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }).encode("utf-8")
    return api_request(
        f"/v1/text-to-speech/{voice_id}?output_format=pcm_24000",
        api_key, data=payload, content_type="application/json", timeout=300,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--narration", required=True, help="JSON from build-demo-video.ps1 -ExportNarration")
    parser.add_argument("--out", required=True, help="Output directory for <key>-raw.wav files")
    parser.add_argument("--voice-id", default="", help="Existing ElevenLabs voice id (else ELEVEN_VOICE_ID from .env)")
    parser.add_argument("--clone", default="", help="60-90s clean speech sample; creates an Instant Voice Clone first")
    parser.add_argument("--clone-name", default="Daming narration", help="Name for the created clone")
    parser.add_argument("--model", default="eleven_multilingual_v2", help="ElevenLabs TTS model id")
    args = parser.parse_args()

    repo_root = pathlib.Path(__file__).resolve().parents[1]
    env = load_env(repo_root / ".env")
    api_key = env.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise SystemExit(f"ELEVENLABS_API_KEY is missing. Put it in {repo_root / '.env'} first.")

    voice_id = args.voice_id or env.get("ELEVEN_VOICE_ID", "") or env.get("ELEVEN_TUTOR_VOICE", "")
    if args.clone:
        sample = pathlib.Path(args.clone)
        if not sample.is_file():
            raise SystemExit(f"Voice sample not found: {sample}")
        print(f"[narration] Creating Instant Voice Clone from {sample.name} …")
        voice_id = create_instant_clone(api_key, sample, args.clone_name)
        print(f"[narration] voice_id = {voice_id}  (save as ELEVEN_VOICE_ID in .env to reuse)")
    if not voice_id:
        raise SystemExit("No voice available: pass --voice-id, set ELEVEN_VOICE_ID in .env, or pass --clone <sample>.")

    narration = json.loads(pathlib.Path(args.narration).read_text(encoding="utf-8-sig"))
    chapters = narration["chapters"]
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = True
    for chapter in chapters:
        key, target, text = chapter["key"], float(chapter["seconds"]), chapter["text"]
        pcm = synthesize_chapter(api_key, voice_id, args.model, text)
        wav_path = out_dir / f"{key}-raw.wav"
        with wave.open(str(wav_path), "wb") as sink:
            sink.setnchannels(1)
            sink.setsampwidth(2)
            sink.setframerate(SAMPLE_RATE)
            sink.writeframes(pcm)
        duration = len(pcm) / 2 / SAMPLE_RATE
        tempo = duration / target
        fit = "OK" if 0.5 <= tempo <= 2.0 else "OUT OF RANGE — adjust the chapter text"
        if fit != "OK":
            ok = False
        print(f"[narration] {key}: {duration:5.1f}s spoken for a {target:.0f}s chapter (atempo {tempo:.2f}) {fit}")

    print(f"[narration] Wrote {len(chapters)} chapters to {out_dir}")
    if not ok:
        print("[narration] At least one chapter cannot be fitted safely; fix before building the video.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

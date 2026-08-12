# Fluent Me × Tavus

Fluent Me is a face-to-face conversation with a personal AI English coach. The learner clicks **Start talking**, joins a private video room with the microphone live, and can talk about anything. Coaching is available on demand instead of being imposed as a lesson sequence.

## Conversation tools

- **How did I sound?** — one specific English note and one more natural version of the learner’s last thought.
- **Say it naturally** — a concise recast that the learner can immediately try.
- **What did you notice?** — tentative feedback about observable pace, pauses, clarity, tone, and optional visible cues.
- **Practice a phrase** — the coach models an exact phrase once; the learner repeats it in the live conversation.

The learner can ask for any of these out loud. The buttons are shortcuts, not modes or locked steps.

The prototype defaults to **Nathan – Bookshelf**, a male Phoenix-4 stock Face verified in this Tavus account. Set `TAVUS_FACE_ID` to override him; the selected Face is sent on every conversation.

## Run locally

```powershell
python -m pip install -r requirements.txt
Copy-Item .env.example .env
cd server
python -m uvicorn app:app --host 127.0.0.1 --port 8901
```

Set a newly rotated credential in `.env`:

```dotenv
TAVUS_API_KEY=...
TAVUS_CONVERSATION_PAL_ID=
TAVUS_FACE_ID=
```

Open `http://127.0.0.1:8901/`. The API key stays server-side. If `TAVUS_CONVERSATION_PAL_ID` is absent, the server creates or reuses the conversation-first v4 PAL. Do not point it at the older scripted lesson PAL.

For the hosted Sites build, store `TAVUS_API_KEY` as a secret runtime environment variable. Never commit it to source or place it in client-side code. Rotate any credential that has appeared in chat or logs.

## Runtime flow

```text
learner clicks Start talking
        │
        ▼
Sites Worker / FastAPI ── server-side x-api-key ──▶ Tavus /conversations
        │                                      private room + meeting token
        ▼
Daily joins with microphone on and camera off
        │
        ├─ spoken turns flow directly into Tavus STT → LLM → voice → Face
        ├─ conversation.respond sends typed questions and coaching shortcuts
        ├─ conversation.echo models only an exact phrase
        └─ conversation.utterance builds the in-tab session transcript
```

Camera is opt-in. The app does not save a second server-side transcript or raw audio/video; the session log is a browser view built from live Tavus events. Service logs record room lifecycle only. Product boundaries and states are documented in [DESIGN.md](DESIGN.md).

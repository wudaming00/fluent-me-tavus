# Fluent Me × Tavus

Fluent Me is a face-to-face lesson with a personal AI English coach. The product interface stays focused on learning: after the learner clicks **Start practice**, the server creates a private video conversation and the UI waits for a playable remote track before showing the coach.

## The lesson

Each of the three phrases follows the same visible loop:

1. **Listen** — the Tavus coach models the sentence.
2. **Repeat** — the learner says the complete sentence.
3. **Fix** — Fluent Me isolates one useful chunk.
4. **Recall** — the model sentence is hidden and the learner retrieves the idea from an English meaning cue.
5. **Use** — the coach asks a real question and the learner uses the phrase in an answer.

Tavus owns the embodied interface: Phoenix face, live video, Raven perception configuration, Sparrow turn-taking, and spoken delivery. Fluent Me owns the pedagogy: the sentence sequence, recording/transcription, one-focus feedback, recall, and local lesson history.

The prototype defaults to **Nathan – Bookshelf**, a male Phoenix-4 stock Face verified in this Tavus account. Set `TAVUS_FACE_ID` to override him; the selected Face is sent on every conversation so an older PAL cannot silently restore its previous default.

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
TAVUS_PAL_ID=
TAVUS_FACE_ID=
```

Open `http://127.0.0.1:8901/`. The API key stays server-side. If `TAVUS_PAL_ID` is absent, the server reuses or creates the versioned Fluent Me PAL. `TAVUS_FACE_ID` is optional; when omitted, Nathan – Bookshelf is used. If no valid Tavus key is available, the page reports that real video cannot connect; it does not substitute a fake face.

For the hosted Sites build, store `TAVUS_API_KEY` as a secret runtime environment variable. Never commit it to source or paste it into client-side code. Rotate any credential that has appeared in chat or logs.

## Runtime flow

```text
learner clicks connect
        │
        ▼
Sites Worker / FastAPI ── server-side x-api-key ──▶ Tavus /conversations
        │                                      private room + meeting token
        ▼
Daily call object joins with camera and microphone off
        │
        ├─ waits for the remote coach video track to become playable
        └─ conversation.echo makes the Tavus coach model exact lesson phrases
```

Connection failures end the remote conversation to avoid orphaned rooms. Hosted deployment is private by default.

The older hack-night practice surfaces remain in the repository, but `/` is now the Tavus language lesson described above.

Product decisions and state semantics are documented in [DESIGN.md](DESIGN.md).

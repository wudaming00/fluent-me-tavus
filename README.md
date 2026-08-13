# Fluent Me × Tavus

Most language apps make learners complete exercises, but the difficult part is speaking naturally when no script is available. Fluent Me uses Tavus CVI to turn practice into a face-to-face conversation with a responsive personal English coach, a two-attempt practice loop, and a grounded session reflection.

## Evaluator handoff

- **Owner-only staging:** https://fluent-me-tavus.wudaming00.chatgpt.site — this Sites deployment currently requires owner authentication and is **not yet reviewer-accessible**.
- **Loom walkthrough:** `ADD_PUBLIC_LOOM_URL_BEFORE_SUBMISSION`
- **Demo and presentation script:** [TAKEHOME.md](TAKEHOME.md)
- **Product decisions and boundaries:** [DESIGN.md](DESIGN.md)

Do not treat the staging URL as proof of a completed live test. Before submission, run the manual end-to-end checklist in [TAKEHOME.md](TAKEHOME.md) against the exact deployed commit and record the result.

## What the prototype does

- **Coach — open conversation:** the learner speaks through a live microphone and the coach responds to meaning instead of forcing a lesson sequence.
- **Coach — help on demand:** **How did I sound?**, **Say it naturally**, and **What did you notice?** request a focused note, recast, or bounded observation after a real turn.
- **Practice — exact phrase modeling:** the learner chooses a target and `conversation.echo` makes the Tavus Face speak that wording exactly.
- **Practice — two real attempts:** the product captures two subsequent learner `conversation.utterance` events, including each transcript and any available Raven audio/visual analysis.
- **Practice — evidence-based comparison:** after both attempts exist, `conversation.respond` asks the PAL to identify one improvement, one next detail, and the strongest version using only the supplied evidence.
- **Session — grounded wrap-up:** the product requests three parts from the conversation that actually happened: one thing communicated well, one useful natural phrase, and one specific thing to practice next.
- **Optional identity setup:** **Create your coach** separates a roughly 60-second face-training recording from a 60–90-second clean voice sample, then combines a Tavus Phoenix-4 Face and an ElevenLabs Instant Voice Clone in a personal PAL.

**Coach**, **Practice**, and **Session** organize one continuous Tavus call. Coach shortcuts can also be requested out loud; Practice adds an explicit capture contract so attempt one and attempt two are real learner turns rather than generated sample data.

### Optional: Create your coach

Personalization is an opt-in setup path, not a prerequisite for talking to the stock coach:

1. The learner explicitly confirms that they are recording their own face and voice and that they have the right to submit both. Face and voice consent are not inferred from microphone or camera permission.
2. The learner records two separate samples: about **60 seconds for the Face** and **60–90 seconds of clean speech for the voice**. Browser capture is local by default so the learner can review or discard it before any provider request.
3. ElevenLabs Instant Voice Cloning receives the explicitly submitted voice sample through the server. The browser never receives the ElevenLabs key. Tavus also receives the dedicated ElevenLabs integration key as part of the personal PAL's private-voice TTS configuration, as required to synthesize that voice.
4. Tavus trains a **Phoenix-4 Face** from a user-owned training-video URL. Tavus currently requires a publicly reachable or signed HTTPS download URL that remains valid for at least 24 hours. Browser recording alone does not create that URL; the learner must provide one from their own storage or finish Face creation in PAL Maker.
5. Personalization is progressive: a ready Face can use the stock Tavus voice, a ready ElevenLabs voice can use the stock male Face, and when both IDs are ready the server creates a full personal PAL using the Phoenix Face, private voice, Raven-1, and Sparrow-1.

Fluent Me stores only `face_id`, `voice_id`, and `pal_id` in `localStorage`. It does not put raw audio, raw video, API keys, or biometric media in browser storage, and it does not add a server-side media archive. Submitting a sample still sends it to ElevenLabs or Tavus for processing under that provider's retention terms.

This path is **not yet end-to-end verified on the hosted site**. The deployed environment still needs a verified `ELEVENLABS_API_KEY` and an ElevenLabs plan or grant with Instant Voice Cloning enabled. It also has no built-in browser-video-to-public-URL upload service. Face training is asynchronous and typically takes roughly **3–4 hours**, so a newly recorded Face will not become available during a short demo.

## Why Tavus

A text chatbot can correct a sentence, but it cannot provide the same embodied practice loop. Fluent Me uses the Tavus Face to model spoken delivery, Raven to supply bounded real-time audio/visual context, Sparrow for natural turn-taking and interruption, and Tavus interaction events to keep coaching and the product UI synchronized.

The default coach is the Tavus stock Face **Nathan – Bookshelf** (Phoenix-4). A different account-compatible Face can be selected with `TAVUS_FACE_ID`.

## Architecture

```text
Browser: custom Fluent Me UI — Coach / Practice / Session
  ├─ Daily call object ─ microphone + optional camera ───────────┐
  ├─ Coach ───── conversation.respond for typed turns/tools       │
  ├─ Practice ── conversation.echo(target)                        │
  │              ◀ two learner utterances + available signals    │
  │              conversation.respond(evidence) → comparison      │
  └─ Session ─── conversation.respond(session evidence) → wrap-up │
                                                                  ▼
Sites Worker or FastAPI ── server-side x-api-key ──▶ Tavus CVI private room
                                                        │
                                                        ├─ PAL: behavior and guardrails
                                                        ├─ Raven-1: perception
                                                        ├─ Sparrow-1: turn-taking
                                                        ├─ STT → LLM → TTS
                                                        └─ Phoenix-4: realtime Face

Optional Create your coach
  ├─ explicit face + voice consent
  ├─ local face capture ── user-owned 24h HTTPS URL ──▶ Tavus Phoenix-4 Face
  ├─ local voice capture ── explicit submit ──▶ server ──▶ ElevenLabs IVC
  └─ either ID can be used; face_id + voice_id ──▶ full personal PAL
                                      └─▶ IDs only in localStorage
```

The browser receives only the private room URL and short-lived meeting token. The long-lived `TAVUS_API_KEY` remains in the Worker or FastAPI environment.

### Tavus pieces used

| Tavus capability | Role in Fluent Me |
|---|---|
| Phoenix-4 Face | Renders the live coach and exact spoken models. |
| Raven-1 | Adds real-time audio and optional visual context with `emotion_recognition: limited`. |
| Sparrow-1 | Handles turn boundaries, pauses, and interruption. |
| PAL | Defines the conversation-first coaching behavior and safety boundaries. |
| `conversation.respond` | Sends typed turns and coaching requests, compares two supplied attempts, and requests the grounded three-part wrap-up through the PAL's LLM. |
| `conversation.echo` | Speaks the selected Practice target exactly; it is deliberately not used for normal answers or comparison. |
| `conversation.utterance` | Builds the visible transcript and supplies the two real Practice attempts plus optional `user_audio_analysis` / `user_visual_analysis`. |

## Run locally

Prerequisites: Python 3.11+ and a Tavus API key with available CVI credits/concurrency.

```powershell
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Add a newly rotated TAVUS_API_KEY to .env
cd server
python -m uvicorn app:app --host 127.0.0.1 --port 8901
```

Open `http://127.0.0.1:8901/`.

Minimum environment:

```dotenv
TAVUS_API_KEY=...

# Required only for Create your coach. The account must also have
# Instant Voice Cloning enabled through its plan or grant.
ELEVENLABS_API_KEY=...

# Recommended for a reproducible evaluator build: pin the verified,
# published v5 conversation/practice PAL rather than an older PAL.
TAVUS_CONVERSATION_PAL_V5_ID=...

# Optional; defaults to Nathan – Bookshelf.
TAVUS_FACE_ID=
```

If `TAVUS_CONVERSATION_PAL_V5_ID` is empty, the app creates or reuses **Fluent Me Conversation Coach v5**. The local FastAPI path keeps this generation in `data/tavus_pal_v5.json`, separate from older PAL caches. Never point the v5 override at the earlier scripted lesson PAL or the v4 PAL, whose prompt does not contain the two-attempt comparison and three-part wrap-up contract. For Sites, set credentials as secret runtime environment variables; never put them in browser code or commit them.

### Checks

```powershell
python -m pytest -q
npm run build
npm run test:worker
```

These tests validate application and Worker behavior with mocks. They do **not** replace the manual Tavus/Daily end-to-end test described in [TAKEHOME.md](TAKEHOME.md).

## Privacy, safety, and current limits

- The product identifies the coach as AI. Camera sharing is off by default and requires an explicit learner action.
- Tavus and Daily process media and conversation data to provide the call and may retain service-side conversation data according to their policies. Fluent Me does not create an additional server-side transcript or store raw audio/video in this prototype.
- **Create your coach** has a separate, explicit consent gate. Its two recordings remain local until the learner chooses to submit them. The app stores only the resulting provider IDs in `localStorage`; it does not persist raw media locally or on the Fluent Me server.
- The face recording cannot be handed directly from browser memory to Tavus in the current build. Face training requires a user-owned public or signed HTTPS video URL valid for at least 24 hours, or completion through PAL Maker. Managing and deleting that externally hosted training file remains the learner's responsibility.
- ElevenLabs IVC and Tavus Phoenix-4 process submitted biometric media under their own policies. Face training can take approximately 3–4 hours. Neither successful mocked tests nor the presence of the setup UI proves that this provider workflow has completed end to end.
- The private-voice PAL configuration sends Tavus a dedicated ElevenLabs integration API key so Tavus can synthesize the voice. Use a narrowly scoped key created for this integration and rotate it independently.
- The visible Session view, Practice attempts, comparison, and wrap-up exist only in the current browser tab. Clearing the view removes local state, not any data retained by Tavus or Daily.
- Raven uses `emotion_recognition: limited` because this is an education product. Feedback is framed as an uncertain observation of available delivery cues, never a fact about emotion, ability, personality, mental health, protected traits, or hiring suitability.
- Before/after comparison is evidence-based: it uses two real Tavus utterance transcripts and any audio/visual analyses actually attached to those turns. It is still an LLM coaching comparison—not a validated pronunciation score, biometric emotion score, certified assessment, or automated learning-outcome claim.
- The three-part Session wrap-up is generated from the current conversation evidence. It is not a durable learner record or independent assessment.
- A live conversation consumes Tavus credits and a concurrency slot. The hosted endpoint should not be made unrestrictedly public without an access or spend control.
- The API credential previously used during development must be rotated before evaluator access, even though it is not present in the tracked source.

## Relevant files

- [server/pages/live.html](server/pages/live.html) — evaluator-visible conversation UI.
- [server/static/live.js](server/static/live.js) — Daily media lifecycle and Tavus interaction events.
- [server/static/live.css](server/static/live.css) — responsive product styling.
- [server/tavus.py](server/tavus.py) — FastAPI-side PAL and conversation integration.
- [server/personalization.py](server/personalization.py) — server-only ElevenLabs IVC, Phoenix-4 Face, status, validation, and personal PAL helpers.
- [server/app.py](server/app.py) — local API routes and server boundary.
- [scripts/build-sites-preview.mjs](scripts/build-sites-preview.mjs) — hosted Worker build and Tavus server calls.
- [tests/sites-worker.test.mjs](tests/sites-worker.test.mjs) — Worker contract tests.
- [tests/test_app.py](tests/test_app.py) and [tests/test_tavus.py](tests/test_tavus.py) — local integration contracts.
- [DESIGN.md](DESIGN.md) — product, coaching, perception, and privacy decisions.
- [TAKEHOME.md](TAKEHOME.md) — demo talk track and final submission checklist.

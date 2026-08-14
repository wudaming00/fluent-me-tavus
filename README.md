# Fluent Me × Tavus

Most language apps make learners complete exercises, but the difficult part is speaking naturally when no script is available. Fluent Me uses Tavus CVI to turn practice into a face-to-face conversation with a responsive personal English coach, a two-attempt practice loop, and a grounded session reflection.

## Evaluator handoff

- **Live product:** https://fluent-me.wudaming00.workers.dev — the submitted build on Cloudflare Workers. Sessions create real Tavus rooms, so concurrency is limited. Its default coach is the author's own consented Phoenix-4 Face and ElevenLabs voice clone: the personalization path, exercised end to end.
- **Public case study:** https://damingwu.com/fluent-me/
- **Narrated walkthrough:** https://damingwu.com/fluent-me/fluent-me-demo.mp4
- **Downloadable PDF:** https://damingwu.com/fluent-me/fluent-me-case-study.pdf
- **Demo and presentation script:** [TAKEHOME.md](TAKEHOME.md)
- **Product decisions and boundaries:** [DESIGN.md](DESIGN.md)

Do not treat the staging URL as proof of a completed live test. Before submission, run the manual end-to-end checklist in [TAKEHOME.md](TAKEHOME.md) against the exact deployed commit and record the result.

## What the prototype does

- **Feedback — open conversation:** the learner speaks through a live microphone and the coach responds to meaning instead of forcing a lesson sequence. The latest real turn shows source-labelled duration, WPM, high-confidence filled pauses, adjacent repeats, and optional Raven observations.
- **Feedback — help on demand:** **Improve my wording**, **Coach this turn**, **Break it into beats**, and **How did I come across?** request a focused recast or bounded observation after a real turn.
- **Practice — exact phrase modeling:** the learner chooses a target and `conversation.echo` makes the Tavus Face speak that wording exactly. Whole phrase, Sounds, Stress & rhythm, and Intonation lenses provide teaching models without pretending transcript data is acoustic assessment.
- **Practice — two real attempts:** the product captures two subsequent learner `conversation.utterance` events, including each transcript, deterministic timing evidence, and any available Raven audio/visual analysis.
- **Practice — evidence-based comparison:** after both attempts exist, `conversation.respond` asks the PAL to identify one improvement, one next detail, and the strongest version using only the supplied evidence.
- **Review — actionable recap:** the learner can create a structured recap without ending the call, while **End session** creates it automatically. It separates **What worked**, a grounded **Phrase to keep**, one concrete **Next rep**, and a coverage-labelled evidence footer. If the coach response is unavailable, deterministic local evidence still produces a useful fallback.
- **Review — language review:** on demand, the latest 12 learner turns become a bounded learner-only review of **Grammar**, **Word choice**, **Natural expression**, and a meaning-preserving **Polished version**. If it is missing or stale, ending the session refreshes it before the room closes. This action sends that bounded snapshot to the live Tavus coach; the result stays in the current tab. It does not force an idiom where plain English is better and does not turn transcript edits into an accent or speaking-ability score.
- **Timed practice:** before entering, the learner can choose 5, 10, 15, or 25 minutes, or an open-ended session. Timed sessions start only when the coach is actually ready, warn once in the final minute, then create the recap and explicitly end the Tavus conversation.
- **Optional Learning History:** with a separate opt-in, finalized sessions can leave a compact on-device recap for later review. History is limited to 20 entries and stores recap text plus small aggregate counts—never the full transcript, audio, video, waveform, pitch contour, or Raven observations. **History** in the top bar opens these local records without creating a Tavus room or spending conversation credits.
- **Progress & Review:** the latest 20 compact-history sessions and learner-approved phrase cards become an honest practice snapshot: saved sessions, timed speaking, recent practice days, saved/due phrases, and the fixed 1/3/7/21/60-day recall path. Encouragement cites real actions; there is no fabricated improvement percentage, ability grade, or punitive streak.
- **Turn Studio — readable voice evidence:** waveform height means relative microphone signal only within that turn; the orange line is an auto-scaled pitch estimate and its gaps are not automatically pauses or errors. A plain-English observation explains the current chart and explicitly avoids pronunciation, accent, fluency, intonation-correctness, or emotion scores.
- **Optional identity setup:** **Create your coach** separates a roughly 60-second face-training recording from a 60–90-second clean voice sample, then combines a Tavus Phoenix-4 Face and an ElevenLabs Instant Voice Clone in a personal PAL.
- **Experimental Future Me:** an owned voice clone can generate reversible Subtle and Balanced target-accent previews. The learner listens before saving; the chosen preview becomes a new voice and the original clone is never edited.

Three tabs — **Feedback**, **Practice**, and **Review** — organize one continuous Tavus call. Coach shortcuts live in **Feedback** and can also be requested out loud; **Practice** adds an explicit capture contract so attempt one and attempt two are real learner turns rather than generated sample data; **Review** holds the session evidence and wrap-up.

### Optional: Create your coach

Personalization is an opt-in setup path, not a prerequisite for talking to the stock coach:

1. The learner explicitly confirms that they are recording their own face and voice and that they have the right to submit both. Face and voice consent are not inferred from microphone or camera permission.
2. The learner records two separate samples: about **60 seconds for the Face** and **60–90 seconds of clean speech for the voice**. Browser capture is local by default so the learner can review or discard it before any provider request.
3. ElevenLabs Instant Voice Cloning receives the explicitly submitted voice sample through the server. The browser never receives the ElevenLabs key. Tavus also receives the dedicated ElevenLabs integration key as part of the personal PAL's private-voice TTS configuration, as required to synthesize that voice.
4. Tavus trains a **Phoenix-4 Face** through PAL Maker's guided recording flow. When training is ready, the learner pastes the returned Face ID into Fluent Me; the app validates its provider status before saving it. A user-owned public or signed HTTPS training URL remains available as an advanced path.
5. Personalization is progressive: a ready Face can use the stock Tavus voice, a ready ElevenLabs voice can use the stock male Face, and when both IDs are ready the server creates a full personal PAL using the Phoenix Face, private voice, Raven-1, and Sparrow-1.
6. After a voice clone exists, **Future Me** can preview General American or General British variants at two strengths. Previewing uses ElevenLabs credits. Saving requires a short-lived server-signed preview handle, creates a separate voice ID, and then creates a new Tavus PAL for the selected voice. The stock coach and original clone remain available if any step fails.

The personalization flow stores only provider IDs plus small selection metadata (`face_id`, active/original/Future-Me `voice_id` values, `pal_id`, target accent, and remix strength) in `localStorage`. Separately, Learning Memory can store an explicitly approved phrase and its compact review metadata. If the learner explicitly enables Learning History, the browser can also retain up to 20 compact finalized-session recaps and aggregate counts. Fluent Me does not put raw audio, raw video, API keys, preview audio, signed preview handles, full transcripts, waveform data, pitch contours, Raven observations, or biometric media in browser storage, and it does not add a server-side media archive. Submitting a sample, requesting a language review, or starting a saved-phrase recall still sends the required data to ElevenLabs or Tavus for processing under that provider's retention terms.

The private hosted environment has been verified with configured Tavus and ElevenLabs credentials. Actual IVC, Voice Remixing, and Face availability still depends on provider account scope, credits, voice eligibility, and training status. The site has no built-in browser-video-to-public-URL upload service. Face training is asynchronous and typically takes roughly **3–4 hours**, so a newly recorded Face will not become available during a short demo.

## Why Tavus

A text chatbot can correct a sentence, but it cannot provide the same embodied practice loop. Fluent Me uses the Tavus Face to model spoken delivery, Raven to supply bounded real-time audio/visual context, Sparrow for natural turn-taking and interruption, and Tavus interaction events to keep coaching and the product UI synchronized.

Out of the box the coach is the Tavus stock Face **Nathan – Bookshelf** (Phoenix-4); `TAVUS_FACE_ID` selects any account-compatible Face. The live deployment pins the author's own consented Face and cloned voice as the default coach.

## Architecture

```text
Browser: custom Fluent Me UI — Feedback / Practice / Review
  ├─ Daily call object ─ microphone + optional camera ───────────┐
  ├─ Feedback ── conversation.respond for typed turns/tools       │
  ├─ Practice ── conversation.echo(target)                        │
  │              ◀ two learner utterances + available signals    │
  │              conversation.respond(evidence) → comparison      │
  └─ Review ──── conversation.respond(session evidence) → recap   │
      ├─ review ─ conversation.respond(latest learner turns)       │
      │            → grammar / wording / naturalness / polish      │
      ├─ timer ─── 60s warning → recap → explicit room end         │
      └─ optional compact on-device history + Practice next        │
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
                                      └─▶ IDs + selection metadata only in localStorage
```

The browser receives only the private room URL and short-lived meeting token. The long-lived `TAVUS_API_KEY` remains in the Worker or FastAPI environment.

### Tavus pieces used

| Tavus capability | Role in Fluent Me |
|---|---|
| Phoenix-4 Face | Renders the live coach and exact spoken models. |
| Raven-1 | Adds real-time audio and optional visual context with `emotion_recognition: limited`. |
| Sparrow-1 | Handles turn boundaries, pauses, and interruption. |
| PAL | Defines the conversation-first coaching behavior and safety boundaries. |
| `conversation.respond` | Sends typed turns and coaching requests, compares two supplied attempts, and requests three speakable recap sections through the PAL's LLM; the UI adds its deterministic evidence overview. |
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

# Optional; signs 15-minute Future Me preview handles. If omitted, the server
# derives a domain-separated signing key from ELEVENLABS_API_KEY.
REMIX_SIGNING_SECRET=...

# Recommended for a reproducible evaluator build: pin the verified,
# published v6 evidence-aware PAL rather than an older PAL.
TAVUS_CONVERSATION_PAL_V6_ID=...

# Optional; defaults to Nathan – Bookshelf.
TAVUS_FACE_ID=
```

If `TAVUS_CONVERSATION_PAL_V6_ID` is empty, the app creates or reuses **Fluent Me Conversation Coach v6**. The local FastAPI path keeps this generation in `data/tavus_pal_v6.json`, separate from older PAL caches. Never point the v6 override at an earlier scripted PAL: v6 contains the source-labelled timing contract, explicit acoustic-evidence boundary, two-attempt comparison, and three-part spoken recap behavior. Fluent Me parses those speakable labels into the structured Session card and keeps the measured overview separate. For Sites, set credentials as secret runtime environment variables; never put them in browser code or commit them.

### Checks

```powershell
python -m pytest -q
npm run build
npm test
```

These tests validate application and Worker behavior with mocks. They do **not** replace the manual Tavus/Daily end-to-end test described in [TAKEHOME.md](TAKEHOME.md).

## Privacy, safety, and current limits

- The product identifies the coach as AI. Camera sharing is off by default and requires an explicit learner action.
- Tavus and Daily process media and conversation data to provide the call and may retain service-side conversation data according to their policies. Fluent Me does not create an additional server-side transcript or store raw audio/video in this prototype.
- **Create your coach** has a separate, explicit consent gate, and Future Me adds a second explicit remix-consent gate. Recordings remain local until the learner submits them. The app stores provider IDs and selection metadata in `localStorage`; it does not persist raw media, preview audio, or signed preview handles locally or on the Fluent Me server.
- The face recording cannot be handed directly from browser memory to Tavus in the current build. Face training requires a user-owned public or signed HTTPS video URL valid for at least 24 hours, or completion through PAL Maker. Managing and deleting that externally hosted training file remains the learner's responsibility.
- ElevenLabs IVC and Tavus Phoenix-4 process submitted biometric media under their own policies. Face training can take approximately 3–4 hours. Neither successful mocked tests nor the presence of the setup UI proves that this provider workflow has completed end to end.
- The private-voice PAL configuration sends Tavus a dedicated ElevenLabs integration API key so Tavus can synthesize the voice. Use a narrowly scoped key created for this integration and rotate it independently.
- The visible Review view, Practice attempts, comparison, Turn Studio charts, full learner transcript, and Language Review exist only in the current browser tab. A recap or Language Review is marked stale when the learner speaks again and can be refreshed. Clearing the view invalidates them locally; it does not remove any data retained by Tavus or Daily.
- The implemented [Learning Memory](docs/LANGUAGE-COACH-REALIZATION.md#learning-memory-mvp-contract) saves a phrase only when the learner chooses **Save for later** after a real transfer check. It uses `localStorage` with a current-tab fallback, supports inspection and individual **Forget**, hides due targets in the UI while instructing the coach not to reveal them, and lets the learner confirm **I used it** or **Not quite**. Reviews use fixed 1/3/7/21/60-day intervals as a transparent MVP product default—not a scientifically optimized or personalized schedule; **Not quite** retries in 10 minutes, while **Show & practise** or revealing a phrase does not advance review or prove mastery. It does not persist transcripts, audio, waveform, pitch, or episode history, and this MVP has no global memory toggle, Clear all, export, or editing.
- Learning History is distinct from Learning Memory and is off by default. Enabling it before a session permits only that future finalized session to add a compact recap/aggregate record; turning it off does not silently delete older records. A compact recap may retain one grounded short learner quote and one useful phrase, while full transcripts and acoustic/visual evidence are never added to history. The learner can inspect, delete one, or clear all on this device.
- Progress & Review derives only from Learning History and Learning Memory. Its visible review rhythm is a transparent fixed product rule—not a measured personal forgetting curve—and a **Not quite** result returns the phrase in about 10 minutes.
- A timed session begins only once the remote coach media is ready. Its final-minute warning is informational; at zero the app uses the same idempotent recap-and-end path as **End session**, including Tavus's explicit conversation-end request. This limits abandoned usage but does not replace provider-side absent/left/max-duration safeguards.
- A session survives its video room. Tavus caps `max_call_duration` at a plan-dependent maximum (observed ≈5 minutes here despite requesting 900 s), so when a live room dies the client reconnects into a fresh room with a bounded, sanitized continuation packet — recent evidence turns plus any practice target — and the coach picks the same conversation back up; the focus timer accumulates across rooms. Rapid repeated failures stop the loop: with evidence, the session ends through the normal idempotent path onto the full-screen review; without it, the manual retry card returns.
- Raven uses `emotion_recognition: limited` because this is an education product. Feedback is framed as an uncertain observation of available delivery cues, never a fact about emotion, ability, personality, mental health, protected traits, or hiring suitability.
- Before/after comparison is evidence-based: it uses two real Tavus utterance transcripts and any audio/visual analyses actually attached to those turns. It is still an LLM coaching comparison—not a validated pronunciation score, biometric emotion score, certified assessment, or automated learning-outcome claim.
- The structured Session recap is generated from the current conversation evidence and uses a bounded local fallback when a coach recap is unavailable. Its metrics disclose how many spoken turns were timed; it is not a durable learner record or independent assessment.
- A live conversation consumes Tavus credits and a concurrency slot. The public deployment accepts that cost deliberately for the review period; it has no spend control yet and can be taken offline afterwards.
- No credential appears in the tracked source or build. Deployments read keys from platform secrets, and any key that ever surfaced in a development context is treated as burned and rotated.

## Relevant files

- [server/pages/live.html](server/pages/live.html) — evaluator-visible conversation UI.
- [server/static/live.js](server/static/live.js) — Daily media lifecycle and Tavus interaction events.
- [server/static/analysis-core.js](server/static/analysis-core.js) — deterministic turn, attempt, and session evidence without a fake overall score.
- [server/static/language-review.js](server/static/language-review.js) — bounded learner-transcript review prompt, strict response parsing, and privacy-labelled copy output.
- [server/static/session-history.js](server/static/session-history.js) — opt-in, whitelisted compact session-history storage.
- [server/static/live.css](server/static/live.css) — responsive product styling.
- [server/tavus.py](server/tavus.py) — FastAPI-side PAL and conversation integration.
- [server/personalization.py](server/personalization.py) — server-only ElevenLabs IVC/Voice Remixing, signed preview validation, Phoenix-4 Face, status, and personal PAL helpers.
- [server/app.py](server/app.py) — local API routes and server boundary.
- [scripts/build-sites-preview.mjs](scripts/build-sites-preview.mjs) — hosted Worker build and Tavus server calls.
- [tests/sites-worker.test.mjs](tests/sites-worker.test.mjs) — Worker contract tests.
- [tests/test_app.py](tests/test_app.py) and [tests/test_tavus.py](tests/test_tavus.py) — local integration contracts.
- [DESIGN.md](DESIGN.md) — product, coaching, perception, and privacy decisions.
- [TAKEHOME.md](TAKEHOME.md) — demo talk track and final submission checklist.
- [docs/LANGUAGE-COACH-REALIZATION.md](docs/LANGUAGE-COACH-REALIZATION.md) — research-backed product model, evidence contract, UI realization, and pronunciation-provider path.

# Fluent Me × Tavus — product design

## Product promise

Fluent Me should feel like talking to a responsive person, with English coaching available whenever the learner asks for it. It is one continuous conversation, not a state machine dressed up as video.

```text
Choose a topic → video conversation ────────────→ keep talking
                         │
                         ├─ ask for English feedback
                         ├─ ask about delivery signals
                         ├─ request a natural recast
                         ├─ practice one exact phrase twice and compare
                         └─ request a grounded session reflection
```

## Screen contract

- Tavus video is the largest surface on desktop.
- The microphone is published to the Daily room after the learner explicitly clicks **Start talking**.
- Camera is off by default and has a clear **Share camera** opt-in with a visible self-view.
- The UI shows only understandable live states: connecting, listening, thinking, coach speaking, and your turn.
- All user-visible interface strings are English.
- A missing or rejected server key produces an explicit error, never a fake human presented as live.
- The near-black, violet, mint, and pale-cyan visual system stays consistent with Fluent Me.

## Coaching contract

| Request | Coach behavior |
|---|---|
| Open conversation | Respond to meaning first; ask at most one natural follow-up. |
| Make it natural | Quote one useful grammar, word-choice, or naturalness change and speak a concise recast. |
| Fix one thing | Choose the highest-impact clarity change and offer one short retry. |
| Break it into beats | Teach thought groups, selective stress, linking, and a model without claiming acoustic diagnosis. |
| How did I come across? | Cite only labelled transcript, timing, or Raven cues; preserve uncertainty and ask whether the impression matches. |
| Voice Lab | Model an exact phrase and capture two learner attempts using a chosen Whole phrase, Sounds, Stress & rhythm, or Intonation lens. |
| Compare attempts | Use only the two captured transcripts and available delivery analyses; name one improvement and one next detail. |
| Wrap up | Return one communication win, one useful phrase, and one next practice grounded in this session. |

These are callable abilities, not locked modes. Direct spoken questions must behave the same as buttons.

## Optional identity setup contract

**Create your coach** is a separate, optional onboarding flow. Skipping or abandoning it always leaves the stock coach available. Permission to use the microphone or camera for a live lesson is not permission to clone an identity.

```text
Explicit consent
  ├─ Face: record about 60s locally → review/discard
  │          └─ user-owned public/signed HTTPS URL (valid ≥24h)
  │               or PAL Maker → Tavus Phoenix-4 training (~3–4h)
  └─ Voice: record 60–90s locally → review/discard → explicit submit
             └─ server relay → ElevenLabs Instant Voice Cloning

face_id only → stock voice + personal Face
voice_id only → personal PAL with stock male Face
face_id + voice_id → full personal PAL → start a new call
```

The two samples stay separate because a clear, low-noise voice sample has different requirements from a face-training performance. The UI must:

- require an affirmative confirmation that the learner owns or is authorized to use the likeness and voice;
- explain which provider receives each sample before submission;
- keep capture local by default and provide review, retry, and discard actions;
- never upload merely because recording stopped;
- show asynchronous Face states honestly rather than implying that capture created a usable Face;
- allow either completed model to improve the coach while the other remains pending;
- preserve the stock coach as the fallback when cloning is unavailable or incomplete.

PAL Maker is the primary Face-training path because it provides guided recording and quality checks. When training is ready, Fluent Me accepts the Face ID, verifies its Tavus status, and saves it only after the provider reports completion. A public or signed HTTPS training-video URL remains an advanced path; an in-memory browser `Blob` is never presented as a complete upload flow.

The hosted site also still requires a verified `ELEVENLABS_API_KEY` and an active ElevenLabs plan or grant that permits Instant Voice Cloning. Phoenix-4 training generally takes around 3–4 hours. Until those dependencies and the full manual checklist are verified, personalization must not be described as end-to-end complete.

The Tavus private-voice TTS layer requires the ElevenLabs `api_key` alongside the external `voice_id`. The server therefore supplies a dedicated, least-privilege ElevenLabs integration key to Tavus when it creates the personal PAL. The browser never receives this key, but the UI and privacy documentation must not imply that ElevenLabs is the only provider receiving it.

## Voice identity and target-accent boundary

A raw voice clone is an identity feature, not a pronunciation model. ElevenLabs cloning can reproduce the learner's accent, cadence, pronunciation, and recording artifacts along with their timbre. Fluent Me therefore keeps three roles separate:

- **Original** is the learner's untouched clone and remains recoverable in the browser profile.
- **Future Me** is an explicitly experimental, newly created voice variant. The learner previews low- and medium-strength target-accent remixes, then chooses whether to save one; the original voice is never edited or deleted.
- **Standard coach** remains the pronunciation reference. A remixed self-voice is motivational feedback, not proof that every sound is correct.

The default experiment targets General American English, with General British as an opt-in alternative. Preview generation consumes provider credits, while saving the selected preview consumes a custom voice slot and creates a new provider-side voice ID. A saved Future Me voice is connected by creating a new Tavus PAL; failed preview, save, or PAL requests leave the current coach and original clone unchanged.

If ElevenLabs remix quality is insufficient, the next production path is **Cartesia clone + Localize + corrected-text TTS**, because Tavus supports Cartesia directly. For true real-time accent conversion, Sanas is the first evaluation candidate and Krisp the enterprise/on-device candidate; those providers require a separate media path or Tavus Echo Mode and must never sit in front of pronunciation analysis, because conversion would erase the original evidence that the coach needs to diagnose.

## Tavus boundary

Tavus provides the full conversational video pipeline: Phoenix Face, Raven-1 perception, Sparrow-1 turn-taking, STT, LLM, and spoken response. Native speech uses the full pipeline. Typed user requests use `conversation.respond`. Only exact phrase modeling uses `conversation.echo`.

Raven is configured with `emotion_recognition: limited` for an education product. Its audio and visual output stays a qualitative coach observation. It must not claim to know an inner emotion or infer ability, personality, protected traits, mental health, or hiring suitability.

The browser correlates `conversation.stopped_speaking` with final `conversation.utterance` events by `inference_id` or `turn_idx`. It may deterministically show whole-turn duration, WPM for sufficiently long samples, high-confidence filled pauses, adjacent repeated words, interruptions, ordered target-phrase transcript coverage, and personal session aggregates. It cannot derive within-turn pause location, phoneme accuracy, syllable stress, or pitch contour from these events. Those acoustic fields remain unavailable until an explicitly consented specialist pronunciation provider returns them. Transcript coverage is never labelled pronunciation accuracy.

## Logging and privacy

The `Session` view reconstructs turns from live `conversation.utterance` events and de-duplicates replica/PAL aliases by inference and content. Optional `user_audio_analysis` and `user_visual_analysis` appear as expandable observable signals when Tavus provides them. The `Voice Lab` view holds the current target, two captured attempts, deterministic transcript/timing evidence, and the coach's grounded comparison in the current browser tab.

The hosted Worker records room creation/end lifecycle events but does not create an extra server-side speech log. Fluent Me does not save raw audio or video. A future durable learning-memory feature requires a separate retention choice and explicit user-facing privacy design.

For **Create your coach**, raw capture lives in transient browser memory until the learner discards it or explicitly submits it. The ElevenLabs voice request passes through the server in memory; Fluent Me does not create a media archive. Face video remains in the learner's chosen external storage or PAL Maker workflow. Only `face_id`, `voice_id`, and `pal_id` are written to `localStorage`—never media blobs, base64 recordings, transcripts, consent recordings, or API credentials. Clearing those IDs disconnects the personal coach locally; it does not itself delete provider-side Face, voice, PAL, or training data.

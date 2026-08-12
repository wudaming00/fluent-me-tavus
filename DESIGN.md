# Fluent Me × Tavus — product design

## Product promise

Fluent Me should feel like talking to a responsive person, with English coaching available whenever the learner asks for it. It is one continuous conversation, not a state machine dressed up as video.

```text
Start talking → open conversation ───────────────→ keep talking
                         │
                         ├─ ask for English feedback
                         ├─ ask about delivery signals
                         ├─ request a natural recast
                         └─ practice one exact phrase
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
| How did I sound? | Give one specific English note and one natural recast. |
| Say it naturally | Speak a concise improved version, then invite a retry. |
| What did you notice? | Cite only observable cues, preserve uncertainty, and ask whether the impression matches. |
| Practice a phrase | Model the exact supplied phrase once; let the learner repeat it in the same conversation. |

These are callable abilities, not locked modes. Direct spoken questions must behave the same as buttons.

## Tavus boundary

Tavus provides the full conversational video pipeline: Phoenix Face, Raven-1 perception, Sparrow-1 turn-taking, STT, LLM, and spoken response. Native speech uses the full pipeline. Typed user requests use `conversation.respond`. Only exact phrase modeling uses `conversation.echo`.

Raven is configured with `emotion_recognition: limited` for an education product. Feedback may mention words, pace, pauses, clarity, tone, background audio, and visible delivery cues when a camera is shared. It must not claim to know an inner emotion or infer ability, personality, protected traits, mental health, or hiring suitability.

## Logging and privacy

The `Session log` reconstructs turns from live `conversation.utterance` events and de-duplicates replica/PAL aliases by inference and content. Optional `user_audio_analysis` and `user_visual_analysis` appear as expandable observable signals when Tavus provides them.

The hosted Worker records room creation/end lifecycle events but does not create an extra server-side speech log. Fluent Me does not save raw audio or video. A future durable learning-memory feature requires a separate retention choice and explicit user-facing privacy design.

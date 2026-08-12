# Fluent Me × Tavus — product design

## Product promise

The learner should always be able to answer two questions without guessing:

- **Who am I talking to?** My personal English coach, or an explicit connection error.
- **What do I do now?** One action in a five-step language-learning loop.

The face is not decoration. It models phrasing, timing, and conversational presence. Fluent Me turns that embodied interface into a repeatable learning sequence.

## Core interaction

```text
Connect real Tavus video
        ↓
Listen → Repeat → Fix one thing → Recall without English → Use in an answer
        ↓
Next sentence (3 total) → review tomorrow
```

Every state has one dominant CTA. Metrics such as WPM, filler counts, hiring signals, and a generic “perception” panel are deliberately absent from the lesson screen.

## Screen contract

- The Tavus video is the largest surface on desktop.
- On mobile, the video and compact step progress stay visible while the task scrolls.
- The Daily call-object surface remains transparent until a non-local Tavus video track is playable; no black frame covers the waiting state.
- The UI may say **Coach is ready** only after that playable remote track exists.
- Every user-visible interface string is English.
- The current prototype uses Nathan – Bookshelf, a male Tavus Phoenix-4 stock Face verified in this account, unless `TAVUS_FACE_ID` explicitly selects another Face.
- The visual system uses the original near-black, violet, and mint Fluent Me palette; mint is reserved for live and successful states.
- A missing or rejected server key produces an error, never a static human presented as live.
- The browser joins Daily with local camera and audio off. Fluent Me requests microphone access only when the learner explicitly starts a speaking attempt.

## Teaching contract

| Step | Coach | Learner | UI result |
|---|---|---|---|
| Listen | Models the full phrase | Watches and listens | Meaning and phrase chunks |
| Repeat | Waits | Reads the phrase aloud | Captured transcript |
| Fix | Models one chunk | Repeats that chunk | One concrete adjustment |
| Recall | Waits | Reconstructs from an English meaning cue | Retrieval evidence |
| Use | Asks a relevant question | Answers with personal content | Phrase used in context |

Keyboard entry is a first-class accessibility path, not an error state. When it is selected, recording actions disappear and the text submission becomes the primary CTA.

## Tavus boundary

Tavus provides the face and live room through a full PAL pipeline. The managed PAL uses Phoenix, Raven-1, and Sparrow-1. Fluent Me passes the selected `face_id` on every conversation, so a cached PAL cannot override the visible coach. Raven observations are uncertain context only and must never become ability, personality, protected-trait, emotion, or hiring judgments.

Fluent Me sends exact model sentences with `conversation.echo`; it does not expose `TAVUS_API_KEY` to the browser. Private conversations use authentication, two-participant limits, finite call duration, and short participant timeouts. Every failure or exit attempts to end the remote Tavus conversation.

## Honest degradation

There is no visual fallback that imitates a connected coach. The non-live visual is an abstract **HELLO / CONNECTING** canvas. A learner can retry the connection; a valid Tavus room is required for the video lesson.

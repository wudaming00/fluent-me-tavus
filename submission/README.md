# Fluent Me

## A conversation-first English coach powered by Tavus CVI

Fluent Me helps a learner practise the English they actually need in a real conversation. Instead of moving through a fixed lesson, the learner speaks face to face with an AI coach, asks for help when it is useful, rehearses one phrase, and leaves with a grounded next step.

This submission focuses on a simple product thesis: **the face is not decoration**. A responsive video coach creates the social pressure, turn-taking, modelling, and continuity that a text correction tool cannot provide on its own. Tavus supplies that real-time conversational surface; Fluent Me turns it into a focused learning loop.

## Submission links

- Demo video: https://damingwu.com/fluent-me/fluent-me-demo.mp4
- Public case study: https://damingwu.com/fluent-me/
- Downloadable PDF: https://damingwu.com/fluent-me/fluent-me-case-study.pdf
- Live product: https://fluent-me.wudaming00.workers.dev — real Tavus rooms, limited concurrency
- Source repository: https://github.com/wudaming00/fluent-me-tavus
- Exact submitted product-code commit: [`50f68e011455`](https://github.com/wudaming00/fluent-me-tavus/commit/50f68e011455e5d764bfbc1a6bfd3282c6a9cc34) — this is what the live deployment runs.
- Build recorded in the walkthrough video: [`031fb20c4245`](https://github.com/wudaming00/fluent-me-tavus/commit/031fb20c4245e526f9f9f40401a74099036250af) — the submitted commit adds, on top of it: automatic in-place coach resume when a Tavus room hits a provider-side duration cap mid-session; the public Cloudflare deployment with the author's own Phoenix-4 Face and cloned voice pinned as the default coach; the demo re-narrated in that same cloned voice; and a documentation pass correcting control and tab names to the ones the product actually ships.
- [92-second demo narration](DEMO_SCRIPT.md)
- [Architecture diagram and technical notes](ARCHITECTURE.md)
- [Delivery checklist](DELIVERY_CHECKLIST.md)

The live deployment is public and was verified signed-out: a real Tavus room was created and cleanly ended through it, and its default coach is the author's own consented Face and cloned voice.

## The project in action

### 1. Start with a real topic

The learner chooses a topic and a 5, 10, 15, or 25 minute session, or an open-ended conversation. Microphone access begins only after the learner starts. Camera sharing is off by default because most speaking practice does not need the learner's video.

### 2. Talk naturally

The browser joins a private Daily room created through Tavus. The microphone publishes into the Tavus conversational pipeline, and the Tavus Face responds to the learner's meaning. The interface stays video-first; feedback remains in a secondary drawer until the learner asks for it.

### 3. Inspect one useful turn

After a completed learner turn, Fluent Me can show:

- the actual learner transcript received through Tavus conversation events;
- duration and words per minute when timing is available;
- transparent transcript counts for filled pauses and adjacent repetitions;
- a transient browser waveform, estimated internal pauses, microphone-level movement, and pitch candidates; and
- optional Raven audio or visual observations, labelled as tentative coach perception rather than ground truth.

The product does not combine these into an opaque English score. It also does not claim that a browser waveform measures pronunciation, accent, emotion, or speaking ability.

### 4. Practise one phrase

The learner can move one phrase into Practice. Tavus models the exact wording, the learner makes two real attempts, and the coach compares only the evidence that is actually available. The intended loop is small and actionable:

**hear it → try it → change one thing → try it again → use it in conversation**

This is coaching, not a certified pronunciation assessment. Phoneme or syllable accuracy would require a dedicated assessment provider and is not inferred from transcript overlap or pitch movement.

### 5. Leave with a review

The Review surface contains two different artifacts:

- **Session recap:** what worked, one next 30–60 second repetition, an optional phrase to keep, and the evidence coverage behind the suggestion.
- **Language review:** grammar, word choice, natural expression, and a fact-preserving polished version based on at most the latest 12 learner turns.

Ending a session follows the same bounded recap-and-cleanup path as a timer reaching zero. The application explicitly ends the remote Tavus conversation so an abandoned page does not intentionally leave a room consuming credits or concurrency.

### 6. Return without creating a new room

Longitudinal features are deliberately local and learner-controlled:

- Learning History is opt-in and retains at most 20 compact finalized-session recaps.
- Learning Memory stores only learner-approved phrases and scheduling metadata.
- Review follows a visible fixed 1/3/7/21/60-day sequence; “Not quite” schedules another try in 10 minutes.
- History and progress can be opened without creating a Tavus room or consuming conversation credits.

The product does not claim that this fixed schedule is a measured personal forgetting curve, and positive feedback cites retained actions rather than inventing a percentage improvement or ability grade.

## Why I chose this project

I chose language practice because it makes the full Tavus system useful, not merely visible.

A text model can rewrite a sentence, but speaking is a real-time coordination problem. The learner has to retrieve language, read another person's timing, manage interruptions, and notice how a phrase sounds when spoken. Tavus brings several capabilities together at exactly that point:

- the **Face** gives the learner a person to address and imitate;
- **Sparrow** supports responsive turn-taking and interruption;
- **Raven** can add bounded context about audible and, when explicitly enabled, visible delivery cues;
- the **PAL** defines the coach's learning behavior and evidence boundaries; and
- Tavus interaction events let the product UI stay synchronized with the live exchange.

This also creates a useful customer-engineering challenge. The experience succeeds only when product behavior, real-time media transport, model prompting, privacy, and operational cleanup all work together.

## Product thought process

### From a lesson wizard to an open conversation

The first direction was a rigid sequence: listen, repeat, fix, recall, and use. It was easy to explain as a diagram, but it made the Tavus Face feel attached to a worksheet. The learner could not simply ask a question or follow an interesting conversational turn.

I changed the information architecture around one continuous call:

- the video conversation is the primary surface;
- feedback is requested, not forced;
- Practice is an optional focused tool; and
- Review is the place for recap, transcript work, and later reflection.

The current simplified UI keeps the coach video dominant and moves detailed analysis behind a drawer or disclosure. The goal is to let a first-time learner speak before learning the interface.

### Separate evidence from interpretation

The product uses three explicit evidence classes:

1. **Measured or counted:** turn timing, transcript tokens, filled-pause counts, adjacent repeats, and browser signal summaries.
2. **Model perception:** Raven observations, preserved as qualitative and uncertain.
3. **Teaching guidance:** a suggested stress pattern, recast, or delivery model that helps the learner practise but is not presented as a measurement.

This separation prevents a common multimodal product failure: converting every available signal into false certainty.

### Design the lifecycle, not only the happy path

Real-time AI products have operational states that ordinary form-based demos can ignore. Fluent Me handles connecting, remote-media readiness, coach speaking, learner speaking, interaction timeouts, manual end, timed end, page exit, and connection failure. The timer begins only after the coach is actually ready, and end paths converge on one cleanup flow.

### Keep memory useful and bounded

The prototype has no server-side learner profile. Full transcripts, audio, video, waveform samples, pitch contours, and Raven observations are not added to Learning Memory or compact History. The learner opts in before a session can save a compact recap and can inspect or delete local entries.

## High-level architecture

The browser owns the custom learning experience and joins the Tavus-created Daily room with a short-lived meeting token. A Sites Worker or FastAPI server owns provider credentials, creates and ends Tavus conversations, and supports optional personalization. Tavus owns the real-time conversational pipeline.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the diagram, event flow, trust boundaries, and provider-specific details.

## Optional personal coach

The core product works with a stock Tavus Face. An optional setup path can create a more personal coach:

- Tavus/PAL Maker supplies the trained Phoenix Face;
- ElevenLabs Instant Voice Cloning creates a voice from an explicitly submitted sample;
- Voice Remixing can generate target-accent variants for comparison; and
- the server creates a Tavus PAL that references the selected Face and voice.

This path is consent-gated and provider-dependent. Account entitlement, credits, voice eligibility, recording quality, and asynchronous Face training all affect whether it completes. The presence of the setup UI or mocked tests is not proof of a successful provider run. The final submission should demonstrate it only if the exact submitted build has passed the optional-personalization checks.

## What is implemented versus what still needs proof

| Area | Current status | Honest boundary |
|---|---|---|
| Tavus conversation creation, Daily join, events, and explicit end | Implemented in both hosted Worker and FastAPI paths | The exact submitted deployment still needs a signed-out, real-microphone end-to-end recording |
| Continuous Face-to-face coaching | Implemented product flow | Do not substitute the loading state or a static image for a live Face |
| Turn metrics and browser acoustic visualization | Implemented as deterministic/transient analysis | Descriptive signal evidence, not pronunciation or emotion scoring |
| Raven perception | Supported when Tavus returns evidence | Missing evidence remains missing; observations are tentative |
| Two-attempt phrase practice and comparison | Implemented interaction contract | Comparison quality is model coaching, not a validated learning outcome |
| Session recap and bounded Language Review | Implemented with defensive parsing and fallback behavior | Review text is current-tab data and does not prove improved English ability |
| Local Learning Memory, opt-in History, and fixed review schedule | Implemented on device | No account sync and no personalized forgetting-curve claim |
| ElevenLabs cloning and Voice Remixing | Optional server integration implemented | Provider access and the final live run must be verified separately |
| Tavus Face training/personal PAL | Optional integration implemented | Face training is asynchronous and requires a valid provider workflow; do not imply instant completion |

## What I would do next

1. Run and record the full evaluator flow against the exact production commit.
2. Add controlled reviewer access and spend limits before making live room creation broadly available.
3. Instrument funnel and latency events without storing learner media or full transcript history.
4. Test whether learners prefer feedback during the conversation or only at the end.
5. Evaluate a specialist pronunciation provider before adding phoneme, syllable, stress, or prosody scores.
6. Add account sync only after designing explicit consent, retention, export, and deletion controls.

## Reviewer note

The public walkthrough is a narrated tour built from real session captures — the closing chapter shows the public case-study page rather than the app — and includes a short continuous Tavus Face motion sequence. It demonstrates the product surfaces and a grounded returned transcript, but it does not claim to prove learner-audio transport or remote cleanup. Controlled access to the exact API-powered build is available for a continuous evaluator run; expected UI text, mocked responses, and integration code are never presented as live-provider proof.

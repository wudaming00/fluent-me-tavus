# Fluent Me: Language Coach Product Realization

## Product thesis

Fluent Me is a live, face-to-face English coach, not a pronunciation scorecard and not a fixed lesson wizard. The learner should be able to talk naturally, ask questions such as “How did that sound?” or “Can you make this more natural?”, see what the coach actually perceived, work on one high-impact change, and immediately use it in another real answer.

The product optimizes for **intelligibility, comprehensibility, and communicative effectiveness**. It does not optimize for erasing a learner’s accent. Accent strength, intelligibility, and listener effort are related but distinct constructs; a noticeable accent can still be fully understandable ([Munro & Derwing](https://doi.org/10.1075/jslp.20038.mun)). The CEFR likewise treats phonological competence as a combination of sound articulation and prosody, with intelligibility as the central outcome ([CEFR phonological competence](https://www.coe.int/en/web/common-european-framework-reference-languages/phonological-competence), [CEFR Companion Volume](https://rm.coe.int/cefr-companion-volume-with-new-descriptors-2020/16809ea0d4)).

### Product principles

1. **Conversation first.** The coach is always available for an open exchange; exercises are tools inside the conversation, not the product’s navigation model.
2. **One useful correction per turn.** Surface the change most likely to improve meaning or listener effort, then let the learner retry. Focused oral corrective feedback is more actionable than a wall of simultaneous corrections ([Lyster & Saito](https://doi.org/10.1017/S0272263109990520)).
3. **Show evidence, not invented certainty.** Every observation says whether it came from transcript analysis, timing, coach perception, or a specialist pronunciation model.
4. **Teach transfer, not imitation alone.** A learner hears and repeats a model, then uses the same pattern in a new sentence. Shadowing can help, but the evidence is variable and it should be paired with meaning and feedback ([shadowing review](https://www.tandfonline.com/doi/full/10.1080/29984475.2025.2546827)).
5. **Personal progress beats universal targets.** Pace, pause, and delivery are interpreted against the task and the learner’s own baseline, not a single “native” benchmark.
6. **The face is the interaction surface.** Tavus video remains visually dominant because eye contact, turn-taking, and responsive behavior make the coaching feel like a person rather than a dashboard.

## Evidence contract

The UI must distinguish measured signals from interpretations. A polished interface must never make weak evidence look scientifically precise.

| Evidence source | Reliable product uses | Claims to avoid | UI label |
| --- | --- | --- | --- |
| Conversation transcript | Exact learner words; grammar; vocabulary; natural phrasing; discourse structure; filler and repeated-word counts | Phoneme correctness, stress placement, or exact pronunciation accuracy from text alone | **Transcript analysis** |
| Tavus speaking events and timestamps | Turn duration, interruption state, turn order, words per minute, and aggregate speaking time. Correlate events with `inference_id` and `turn_idx` ([speaking events](https://docs.tavus.io/sections/event-schemas/conversation-started-stopped-speaking), [utterance events](https://docs.tavus.io/sections/event-schemas/conversation-utterance)) | Exact pause placement or articulation rate when word-level timestamps are unavailable | **Measured from timing** |
| Tavus Raven audio/visual analysis | Qualitative observations about energy, hesitation, visible engagement, and how delivery may have come across in context ([Tavus models](https://docs.tavus.io/sections/models)) | Clinical emotion detection, a learner’s internal emotional state, or validated pronunciation scores | **Coach perception** |
| Browser audio processing | Waveform, input level, voice activity, and descriptive pitch contour when signal quality permits | “Correct” pronunciation or emotion; pitch alone is not intonation competence | **Device signal** |
| Dedicated pronunciation provider | Provider-supported phoneme, syllable, word, completeness, fluency, and prosody analysis. Azure is one possible implementation ([Microsoft Pronunciation Assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)) | Cross-language or cross-accent validity beyond provider documentation; unsupported languages; content claims from retired SDK features | **Pronunciation model** |

Until a dedicated pronunciation provider is integrated, Fluent Me can **teach** sounds, syllables, stress, rhythm, linking, and intonation using models and explanations, but it must not claim that it has measured phoneme-level correctness.

## Core learning loop

The primary loop is short enough to repeat naturally during a conversation:

1. **Talk.** The learner answers a meaningful prompt or speaks freely with the coach.
2. **Confirm meaning.** The coach briefly reflects what it understood. This makes communicative success visible before correction.
3. **Notice one thing.** Fluent Me selects one high-value target from Words, Sounds, Rhythm, or Presence and shows the exact learner phrase that motivated it.
4. **Hear a model.** The coach gives a natural version, optionally split into syllables, stressed words, and thought groups.
5. **Try again.** The learner repeats or recasts only the relevant phrase. The comparison uses available evidence and does not invent a composite score.
6. **Use it.** The learner puts the pattern into a fresh, meaningful sentence or continues the conversation with it.
7. **Recall later, if saved.** After a real transfer check, the learner may explicitly choose **Save for later**. That approved target can then return naturally in a future conversation. Retrieval and spacing improve durable learning ([retrieval practice](https://doi.org/10.1111/j.1467-9280.2006.01693.x), [spacing](https://doi.org/10.1111/j.1467-9280.2008.02209.x)).

The coach may enter the focused loop automatically after a turn, or the learner may invoke it conversationally: “Make that natural,” “Help with the rhythm,” “Did I sound confident?”, or “Let me try that again.”

## Learning Memory MVP contract

This section describes the implemented MVP boundary. Learning Memory is a small phrase-recall system, not a conversation-history or learner-model service.

### Consent and control

- There is no global enable toggle. Consent happens per target: nothing is saved merely because a conversation, Voice Lab attempt, or comparison occurred.
- **Save for later** becomes available only after the learner has completed a real transfer answer. Transcript coverage shows whether the target wording appeared as supporting evidence, not as proof of pronunciation, meaning, or mastery.
- Pressing **Save for later** is the explicit persistence action. Leaving the target unsaved creates no durable learning item.
- Saved items are visible in the Session tab. The learner can inspect each phrase and remove it with its individual **Forget** action.
- The MVP has no **Clear all**, export, editable item, global memory toggle, or episode-memory control. It saves approved phrase targets, not past conversations.

### Minimal on-device record

The durable record is a compact, learner-approved learning item: model phrase or pattern, focus, short cue, source, fixed review step, due time, and last-review timestamps. It is not a conversation archive.

Fluent Me must not persist the learner's turn transcript, raw or processed audio, video, waveform samples, pitch contour, per-frame acoustic features, Raven observations, or a copy of the coach conversation as part of Learning Memory. Those signals may be used transiently during the live turn and must be discarded when the in-tab analysis no longer needs them. A learner-approved model phrase is stored as the learning object; the original turn that produced it is not.

The browser writes this record to `localStorage`. If durable browser storage is unavailable, the same record remains only in the current tab and the UI says so. The MVP has no account sync and no Fluent Me server-side learner-history database. When a due item is practiced, the browser passes only that approved phrase/pattern and its short cue into the active Tavus conversation so the coach can create the recall opportunity. This network use must be disclosed even though the durable source of truth remains on the device.

### Natural recall, not a flash-card interruption

- At the start of a conversation, the client checks due items on device and exposes a **Start recall** action when one is ready.
- When the learner starts recall, the client hides at most one due target and instructs the coach to weave it into a relevant follow-up or role-play prompt without revealing the answer. For example, a saved tradeoff pattern can return while discussing a different product decision.
- The learner may answer naturally or cancel while waiting for an answer. After an answer, **Show & practise** can reveal the target without advancing it. Recall must never block the open conversation.
- After the attempt, the learner—not the model—confirms the outcome: **I used it** or **Not quite**. Transcript matching can support the UI but cannot silently advance the item.
- **Show & practise** reveals the phrase and moves it into Voice Lab without advancing its review schedule.

### Fixed review schedule

The MVP uses a transparent fixed schedule rather than fitted FSRS or inferred memory parameters. A saved item is eligible for recall immediately. Each learner-confirmed **I used it** outcome schedules the next recall after 1, 3, 7, 21, and 60 days in sequence. **Not quite** resets the item to the first review step and makes it due again in 10 minutes.

The implementation must not claim to estimate stability, retrievability, difficulty, or an optimal personal forgetting curve. Adaptive scheduling is a later experiment that requires enough consented outcome data and separate validation.

### Rehearsal is not mastery

Listening to the model, choosing **Show & practise**, revealing the phrase, shadowing it, or reading and repeating while it remains visible counts as **rehearsal**. These actions can be useful, but they are not evidence of independent recall and do not advance the review step.

Producing the target without seeing it in a changed context, followed by **I used it**, is recorded as learner-confirmed independent recall. The MVP may describe later items as established for scheduling purposes, but it must not tell the learner that revealing, rehearsing, or completing one recall proves mastery of English.

## Product modes and information architecture

### Welcome

The first screen should explain the interaction in one sentence: **Talk naturally. Notice one thing. Try it again.** The Tavus coach preview and primary **Start conversation** action must be above the fold. Supporting copy introduces four lenses without turning them into a setup form:

- **Words** — grammar, vocabulary, phrasing, and message structure.
- **Sounds** — sound and syllable teaching; measured pronunciation only when a dedicated provider is connected.
- **Rhythm** — pace, pauses, stress, thought groups, linking, and intonation.
- **Presence** — qualitative audio/visual perception such as energy, hesitation, and visible engagement.

An “How feedback works” disclosure should state: **No fake overall score. Every insight shows its evidence source.**

### Live conversation

The layout is a two-column conversation console:

- **60–65% video stage:** the Tavus face, live captions, connection state, camera/microphone controls, and a compact current-focus chip.
- **35–40% contextual panel:** three tabs—**Coach**, **Voice Lab**, and **Session**. The panel changes with the conversation but never blocks free speech.

On mobile, the coach video remains visible in a compact sticky stage while the feedback panel scrolls below it.

### Coach tab

The default view contains:

- A conversational text box for questions or typed fallback.
- Quick tools: **Make it natural**, **Fix one thing**, **Break it into beats**, and **How did I come across?**
- A **Last turn** card containing:
  - what the coach understood;
  - the learner’s exact transcript;
  - one coaching focus and a natural alternative;
  - pace, duration, fillers, and repairs when available;
  - a tentative delivery observation when Raven supplied evidence;
  - a visible evidence label on every observation.
- Actions: **Hear it**, **Try it**, and **Use it in conversation**.

Only the one chosen target is visually prominent. Secondary analysis stays behind an optional **See the details** disclosure.

### Voice Lab tab

Voice Lab is a focused practice tool, not a mandatory five-step wizard. It starts with the current phrase and offers four lenses:

- **Whole phrase** — model, repeat, compare, transfer.
- **Sounds** — syllable split, mouth/articulation cue, minimal contrast, and a slow/normal model.
- **Stress & rhythm** — stressed syllables, thought groups, pause points, reduction, and linking.
- **Intonation** — descriptive pitch movement and pragmatic meaning (for example, certainty versus openness).

Two-attempt comparison shows only supported changes: timing, transcript coverage, fillers, repairs, and qualitative perception. Phoneme or prosody scores appear only when the specialist provider returned them.

### Session tab

The recap is a learning artifact, not an analytics dump:

- communication win;
- active target;
- before/after phrase;
- saved useful phrases;
- speaking turns, average pace, fillers, and practice attempts;
- next review suggestion and one prompt for transfer.

## Metric definitions

Metrics remain descriptive and contextual:

- **Turn duration:** Tavus user speaking duration for the correlated completed turn.
- **Words per minute:** `transcript word tokens / (turn duration seconds / 60)`. Display only with a valid duration and enough speech to be meaningful.
- **Pace trend:** change relative to the learner’s recent comparable turns. “Faster” or “steadier” is preferable to a universal red/green target.
- **Fillers:** transparent count of configured tokens and phrases such as “um,” “uh,” and “you know.” Show the detected items so the learner can verify them.
- **Repairs:** repeated adjacent words/phrases and explicit restarts detectable from the transcript. Label as a transcript estimate, not a complete disfluency count.
- **Transcript coverage:** token-level overlap between the target phrase and the recognized attempt. This measures recognition/coverage, not pronunciation accuracy.
- **Pause measures:** only calculate pause count, pause ratio, or articulation rate when audio/word timing supports them. Fluency should be treated as speed, breakdown, and repair dimensions rather than one WPM value ([Tavakoli et al.](https://journals.sagepub.com/doi/10.1177/02655322231151384)).
- **Sound, syllable, stress, and prosody measures:** provider-specific outputs shown with provider/language limitations. They never roll into a universal “English score.”

For calibration, analytic speaking rubrics such as ETS’s separate dimensions are a better conceptual model than a single opaque score ([ETS analytic speaking guides](https://www.ets.org/research/policy_research_reports/publications/report/2013/jqoc.html)).

## Realization architecture

1. Tavus CVI provides the live replica, turn-taking, captions, PAL responses, and Raven observations.
2. The client correlates `conversation.stopped_speaking` and final `conversation.utterance` events by `inference_id`/`turn_idx` before calculating deterministic timing and transcript metrics.
3. A small, testable analysis module calculates tokens, WPM, fillers, repetitions/repairs, phrase coverage, attempt comparison, and session aggregates.
4. PAL receives the actual transcript plus labeled evidence. Its response schema requests: understood meaning, one target, natural version, short explanation, model phrase, and transfer prompt.
5. Raven audio/visual output is passed through as tentative evidence, not converted into numeric certainty.
6. A provider adapter can later add phoneme/syllable/prosody results without changing the UI contract. Unsupported or missing fields remain absent rather than being estimated.
7. The Learning Memory adapter stores learner-approved items in `localStorage` with a tab-only fallback, reads due items locally, injects the minimum due-item context into the active conversation, and advances scheduling only from learner-confirmed outcomes. It does not persist transcripts or acoustic evidence.

## Safety, honesty, and learner trust

- Never diagnose emotion. Use language such as “You may have sounded hesitant” and allow the learner to disagree.
- Never equate accent with poor English, intelligence, confidence, or professionalism.
- Never present transcript-based estimates as acoustic measurements.
- Avoid a gamified 0–100 overall score. Show the communication outcome, the evidence, and a next action.
- Explain microphone/camera use before starting and keep visible device controls during the call.
- Do not persist transcript, audio, video, waveform, or pitch data in Learning Memory. Persist only an explicitly approved model phrase/pattern and compact scheduling metadata on device.
- Let learners inspect each saved phrase and remove it with **Forget**. Editing, bulk deletion, export, and episode memory are outside the implemented MVP.
- When confidence is low or signals disagree, say so and ask the learner to repeat instead of fabricating feedback.

## Delivery scope

### MVP: truthful and useful now

- Live Tavus coach with continuous conversation and captions.
- Full-English dark violet/mint UI with a dominant coach video.
- Grammar, vocabulary, natural phrasing, discourse, and task feedback from transcript/PAL.
- Deterministic duration, WPM, fillers, transcript repetitions/repairs, phrase coverage, and session aggregates.
- Qualitative Raven delivery feedback with explicit **Coach perception** labeling.
- One-fix → model → retry → transfer loop.
- Voice Lab that teaches syllables, stress, rhythm, and intonation without claiming acoustic scoring.
- Session recap and the bounded Learning Memory implementation described above.

### MVP: on-device Learning Memory

- Explicit per-target **Save for later** after a completed transfer check; there is no global memory toggle.
- `localStorage` persistence with an honest current-tab fallback when browser storage is unavailable.
- Inspectable saved phrases and individual **Forget** actions; no Clear all, export, editing, or episode memory.
- Natural hidden-target recall inside conversation, followed by learner-owned **I used it** or **Not quite** confirmation.
- Fixed 1, 3, 7, 21, and 60-day success intervals; **Not quite** schedules another try in 10 minutes.
- **Show & practise**, reveal, and rehearsal do not advance review and do not claim mastery.
- No transcript, audio, waveform, pitch, video, or Raven-observation persistence in the learning item.

### Next stage: acoustic depth

- A dedicated pronunciation-provider adapter with documented language/locale support.
- Phoneme and syllable alignment, word accuracy, completeness, stress, and prosody where supported.
- Robust word timestamps for pause location, pause ratio, and articulation rate.
- Personalized baselines by task type, not a population-wide pace target.
- Validated adaptive scheduling and cross-session progress views, only after the fixed-schedule MVP has been evaluated.
- User-created face/voice replica onboarding with explicit consent and status visibility.

## Product acceptance criteria

The realization is successful when a first-time learner can start talking without learning the interface; always see and hear the coach; ask a free-form coaching question; understand what evidence produced each insight; improve one phrase; use it in a new sentence; and leave with one memorable next action. No visible score or claim may imply phoneme, syllable, stress, emotion, or prosody precision that the connected evidence source cannot support.

Learning Memory acceptance additionally requires that no item persists before its post-transfer **Save for later** action; durable storage contains only the approved learning item and fixed scheduling metadata; storage failure falls back honestly to the current tab; for a due item, the client hides the target and instructs the coach not to reveal it before the learner answers; **Show & practise** and other rehearsal do not advance review; only **I used it** advances the 1/3/7/21/60-day schedule; **Not quite** schedules a 10-minute retry; and every saved item has an individual **Forget** action. The UI must not imply that global enable/disable, Clear all, export, editing, or episode memory exists.

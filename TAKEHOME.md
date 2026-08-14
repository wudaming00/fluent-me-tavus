# Fluent Me × Tavus — take-home walkthrough

This is the evaluator-facing runbook for a 3–4 minute recording. It is intentionally written as a script, but the product portion should be performed against a real Tavus conversation rather than replaced with static screenshots.

## Demo script (3–4 minutes)

### 0:00–0:25 — Problem and product thesis

> Language learners usually know more English than they can retrieve in a real conversation. Fluent Me combines a personal video coach with a focused loop: talk freely, practice one phrase twice, compare real evidence, and leave with one grounded next step.

Show the welcome screen. Point out that microphone access begins only after **Start session**, and camera sharing remains optional.

Optionally open **Create your coach** for a short product preview. Show that Face and voice are two separate recordings—about 60 seconds for Face training and 60–90 seconds for a clean voice sample—and that both require explicit consent and review before submission. Do not attempt to wait for Face training during this walkthrough: Phoenix-4 training commonly takes roughly 3–4 hours. Unless the exact hosted build has passed the personalization checklist below, say that this is an integration-ready setup flow rather than a completed clone.

### 0:25–0:55 — Start a real CVI conversation

Click **Start session**, then **Use these settings**. Wait for the live Tavus Face and the AI disclosure/greeting to finish. Do not speak over the custom greeting.

Briefly point out the visible state changes—connecting, coach speaking, listening, thinking, and your turn—then introduce the three tabs: **Feedback** for coaching on the latest turn, **Practice** for a two-attempt loop, and **Review** for the evidence and wrap-up.

If the Face, audible greeting, or microphone does not work, stop the recording and diagnose it. Do not present a placeholder or edited screenshot as a successful live run.

### 0:55–1:20 — Coach: free conversation

Say this exact test phrase, at a natural learner pace:

> Yesterday I build this app from zero, and when I explain it I speak too fast because I am a little nervous.

Let the coach respond naturally. This demonstrates that the microphone is reaching Tavus's full conversational pipeline rather than a browser-only recorder, once confirmed in the final manual E2E run.

Briefly open **Review** to show the real user utterance and PAL reply received through `conversation.utterance`. If Tavus supplied `user_audio_analysis` or `user_visual_analysis`, expand **Observable delivery signals** and describe it as an uncertain model observation—not ground truth. Do not claim a signal that is absent.

### 1:20–2:30 — Practice: model, attempt twice, compare

Open **Practice** and enter this exact target phrase:

> Let me walk you through what I built and why it matters.

Start Practice and let the Face model the target. Explain that this step uses `conversation.echo` because exact wording matters.

For **Attempt 1**, say the target once at a deliberately hurried pace. Wait until the product captures the next real learner `conversation.utterance` and shows its transcript plus any analysis Tavus actually returned. Do not continue if the attempt card contains placeholder or stale data.

Use **Try again**, then say the same target more slowly with a clear pause after “built.” Wait for **Attempt 2** to be populated from a second real learner utterance.

Click **Compare attempts** and explain:

> The product sends both transcripts and only the audio or visual analyses actually attached to those turns through `conversation.respond`. The PAL must name one observed improvement, one next detail, and the strongest version. Missing evidence stays missing; there is no numeric score.

Show the two attempt cards and the comparison response together. Call it an evidence-based coaching comparison, not a validated pronunciation or emotion assessment.

### 2:30–2:55 — Coach: bounded perception

Return to **Feedback**, click **How did I come across?**, or ask:

> Based only on what you could actually hear, how did my delivery come across?

Explain that Raven-1 can contribute pace, pauses, clarity, tone, background audio, and—only after explicit camera sharing—visible delivery cues. `emotion_recognition` is `limited`, so the PAL must preserve uncertainty and cannot claim to know an inner emotion.

### 2:55–3:20 — Session: grounded wrap-up

Open **Review** and trigger the final wrap-up flow. Verify that it contains exactly three grounded parts: one thing communicated well, one useful natural phrase from the actual conversation, and one specific next detail to practice. If the output invents evidence or is not returned, treat that as a failed E2E check rather than narrating the expected result.

### 3:20–3:55 — Architecture and why Tavus

Show the architecture diagram in [README.md](README.md) and use the talk track below. End the live room after the wrap-up so the Tavus conversation releases its concurrency slot.

Close with:

> The Face is not a decorative output. Phoenix gives the learner a person to listen to and imitate, Raven provides bounded context about delivery, Sparrow makes the exchange interruptible and natural, and the interaction protocol lets Fluent Me turn those capabilities into a focused learning experience.

## Architecture talk track

Keep this to roughly 30–40 seconds:

1. The browser renders a custom Fluent Me interface and joins the Tavus-created private Daily room with a short-lived meeting token.
2. The microphone publishes directly into the Tavus full pipeline. Camera is off until the learner explicitly opts in.
3. The PAL owns behavior and safety. Raven-1 provides perception context, Sparrow-1 manages conversational timing, and Tavus STT, LLM, TTS, and Phoenix-4 produce the spoken Face response.
4. Coach tools use `conversation.respond`. Practice uses `conversation.echo` for the target, captures two real learner `conversation.utterance` events, then sends those transcripts and available Raven analyses through `conversation.respond` for comparison.
5. Session uses the accumulated utterance evidence to request a grounded three-part wrap-up. The API key never enters the browser.
6. The Worker or FastAPI server creates and ends rooms; every exit path should end the remote conversation to release credits and concurrency.
7. The optional identity path keeps capture local until explicit submission. ElevenLabs IVC creates the voice; Tavus trains a Phoenix-4 Face from a user-owned public or signed HTTPS URL; the backend combines their IDs into a personal PAL. Only the IDs are kept in `localStorage`.

## Customer-engineer iteration story

The first prototype was a rigid five-stage loop—Listen, Repeat, Fix, Recall, Use. It made the product easy to diagram but hard to understand in use: the Face felt attached to a workflow, the learner could not simply ask a question, and the experience looked like a language worksheet with video added.

The product feedback was concrete: make it feel like a real person the learner can talk to, and make coaching different callable abilities rather than locked steps. The UI was therefore rebuilt around one continuous conversation. The latest contract organizes that call into **Feedback**, **Practice**, and **Review**: open conversation stays primary, while Practice captures two real utterances for a bounded comparison and Review turns the accumulated evidence into a three-part close.

That redesign exposed a deeper transport bug. The earlier Daily call object was created with its outgoing audio/video sources disabled and joined with the microphone off. A separate browser speech recognizer could display words, but Tavus could not hear the learner, so the PAL could not answer and Raven had no audio/video input. The integration was corrected so the Daily microphone is live after the explicit **Start session** action, camera remains opt-in, and Tavus `conversation.utterance` events—not a parallel browser recorder—become the conversation source of truth.

A follow-up media issue appeared because repeated participant updates could replace an already-playing remote `MediaStream`. The client now avoids resetting the video element when the remote audio/video track IDs have not changed. The exact deployed build still requires the manual end-to-end verification below before the submission can claim success.

The lesson from both iterations is that a convincing CVI integration depends on product behavior and media plumbing together: a polished Face cannot compensate for a deaf transport, and a working transport cannot compensate for a rigid experience.

## Submission checklist

### Required evidence

- [x] Public recording published: https://damingwu.com/fluent-me/fluent-me-demo.mp4 (README links it).
- [x] Reviewer-accessible build available: https://fluent-me.wudaming00.workers.dev.
- [x] Submission notes pin the exact commits: `80ca0beeffdf` (submitted) and `031fb20c4245` (walkthrough build).
- [ ] Show the Tavus Face moving and speaking in real time; do not rely on the welcome placeholder.
- [ ] Show at least one spoken learner turn followed by a relevant PAL answer.
- [ ] Show the **Feedback**, **Practice**, and **Review** tabs inside one live call.
- [ ] Show **Practice** modeling the exact target phrase in this document with `conversation.echo`.
- [ ] Show two distinct real learner utterances populate Attempt 1 and Attempt 2.
- [ ] Show the comparison grounded in both transcripts and only the audio/visual analyses actually available.
- [ ] Show the Session wrap-up with exactly three grounded parts.
- [ ] Explain Phoenix, Raven, Sparrow, the PAL, `conversation.respond`, `conversation.echo`, and `conversation.utterance`.
- [ ] End the room during the recording.

### Manual end-to-end verification

- [ ] `/api/tavus/status` reports a configured server without revealing the API key.
- [ ] **Start session** → **Use these settings** requests microphone permission and joins with outgoing audio on.
- [ ] The live Face video appears and audible AI disclosure/greeting completes.
- [ ] A spoken user turn appears as a `conversation.utterance` event and receives a contextually relevant reply.
- [ ] PAL/legacy replica duplicate events render only once in the Session turn list.
- [ ] **Mute mic** and **Turn mic on** change the actual Daily local audio state.
- [ ] **Enable visual coaching** is opt-in, shows the self-view, and can be stopped.
- [ ] **Improve my wording**, **Coach this turn**, **Break it into beats**, and **How did I come across?** use reasoned PAL responses.
- [ ] Practice `conversation.echo` says the submitted target exactly and is not mistaken for a learner attempt.
- [ ] Attempt 1 and Attempt 2 come from two subsequent real user `conversation.utterance` events, not timers, placeholders, PAL speech, or sample data.
- [ ] Each attempt keeps only the `user_audio_analysis` / `user_visual_analysis` actually attached to that utterance.
- [ ] **Compare attempts** remains disabled until both attempts exist, then sends both evidence bundles with `conversation.respond`.
- [ ] The comparison identifies one improvement and one next detail without inventing a signal or numeric score.
- [ ] The Session wrap-up contains exactly one strength, one natural phrase, and one next practice detail grounded in the current session.
- [ ] The wrap-up request completes or fails honestly before the remote room is closed; it never fabricates a local success state.
- [ ] Typed input receives a natural response.
- [ ] Autoplay fallback can be recovered by clicking the video.
- [ ] **End session**, connection failure, and page exit attempt to end the remote Tavus conversation.
- [ ] No stale PAL is used; the verified published v6 PAL is pinned with `TAVUS_CONVERSATION_PAL_V6_ID`.

### Optional personalization verification

Do not check these items based on mocked tests or UI presence alone. Run them with the exact deployed commit and the accounts intended for the demo.

- [ ] `/api/personalization/status` reports provider availability and sanitized ElevenLabs quota/voice-slot fields without exposing either API key.
- [ ] The hosted runtime has a verified `ELEVENLABS_API_KEY`, and the ElevenLabs account has an active plan or grant with Instant Voice Cloning enabled.
- [ ] **Create your coach** clearly requests consent to use the learner's own likeness and voice; leaving consent unchecked blocks every provider submission.
- [ ] Face and voice use separate capture steps: approximately 60 seconds for Face training and 60–90 seconds of clean speech for ElevenLabs IVC.
- [ ] Starting capture requests the relevant browser permission. Stopping capture produces a local review/retry state and does not upload automatically.
- [ ] Discarding or closing setup releases the local recording and creates no Face, voice, PAL, or stored media.
- [ ] Raw audio/video, base64 media, API keys, and consent recordings never appear in `localStorage`; only `face_id`, `voice_id`, and `pal_id` are stored after successful provider responses.
- [ ] The voice sample is sent only after explicit submission as multipart media through the server to ElevenLabs IVC; the ElevenLabs key never reaches the browser.
- [ ] Voice-clone success returns a real `voice_id`; plan/grant, credit, validation, and rate-limit failures remain visible errors rather than a fake ready state.
- [ ] The Face step makes PAL Maker the recommended guided path, accepts its Face ID on return, and saves it only after Tavus reports the Face as completed. The hosted-video URL remains an advanced option.
- [ ] Face creation rejects HTTP, credential-bearing, localhost, and private-IP URLs before calling Tavus.
- [ ] A real eligible video starts Phoenix-4 Face training and returns a `face_id`; status polling continues to `completed` or displays the real error. Budget approximately 3–4 hours for this check.
- [ ] Progressive activation works honestly: Face-only uses the stock voice, voice-only uses the stock male Face, and both real IDs create a full personal PAL with `eleven_flash_v2_5`, Raven-1 limited perception, and Sparrow-1 turn-taking.
- [ ] A new conversation sends the saved personal `pal_id` and `face_id`, then visibly and audibly uses the correct personal coach.
- [ ] Clearing the saved IDs returns subsequent sessions to the stock Face without claiming that provider-side resources were deleted.

### Engineering checks

- [ ] `python -m pytest -q`
- [ ] `npm run build`
- [ ] `npm run test:worker`
- [ ] `git diff --check`
- [ ] Confirm no secret appears in tracked files or Git history.
- [ ] Confirm all README links and referenced paths resolve.

## Handoff status (2026-08-14)

Resolved with direct evidence:

- **Reviewer access:** the submitted build is public at https://fluent-me.wudaming00.workers.dev (Cloudflare Workers; no login). A live room was created and cleanly ended through it, and a real conversation session was exercised in the browser on the deployed build.
- **Public recording:** the narrated 92-second demo is published at https://damingwu.com/fluent-me/fluent-me-demo.mp4 with captions and a transcript.
- **Personalization:** the live deployment holds a verified `ELEVENLABS_API_KEY`, and its default coach is the author's own personal PAL — Phoenix-4 Face "Daming Aug 13 2026" (trained via PAL Maker) plus a consented ElevenLabs voice clone. The demo narration uses the same clone.
- **PAL reproducibility:** the deployment pins its PAL explicitly (`TAVUS_CONVERSATION_PAL_V6_ID`); the stock evidence-aware v6 PAL remains available as a documented fallback.
- **Credentials:** nothing credential-bearing is tracked; deployments read platform secrets, and any key that surfaced during development is treated as burned and rotated.

Remaining honest gaps:

- **Credits and concurrency:** each live room consumes credits and one concurrency slot; the public endpoint deliberately has no access or spend control during the review period.
- **Checklist coverage:** the manual end-to-end checklist above has not been re-run item-by-item against the final commit; mocked tests still do not prove every browser media behavior.
- **In-browser Face upload:** local capture still cannot produce the public HTTPS training URL Tavus requires; PAL Maker (used here) or user-owned hosting remains the path, and Phoenix-4 training takes roughly 3–4 hours.

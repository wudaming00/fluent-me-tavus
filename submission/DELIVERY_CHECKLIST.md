# Fluent Me — delivery checklist

Do not mark an item complete because the UI exists or a mocked test passes. Final evidence must come from the exact submitted commit and deployment.

## Submission package

- [ ] Replace `ADD_PUBLIC_DEMO_URL` in `README.md` with a public, signed-out-accessible recording.
- [ ] Replace `ADD_REVIEWER_BUILD_URL` with a reviewer-accessible build, or state clearly that the video is the primary artifact.
- [ ] Replace `ADD_COMMIT_SHA` with the exact submitted Git commit.
- [ ] Confirm `README.md`, `DEMO_SCRIPT.md`, `ARCHITECTURE.md`, and this checklist are included.
- [ ] Confirm every relative Markdown link resolves.
- [ ] Confirm the final materials contain no API key, meeting token, signed preview handle, private recording URL, or biometric sample.

## Product demo evidence

- [ ] Open the build in a signed-out browser and verify the intended reviewer access.
- [ ] Show the simplified welcome screen and start a real session.
- [ ] Show the live Tavus Face moving and speaking; do not use the waiting state or a static image as proof.
- [ ] Say one real learner turn and show a contextually relevant coach response.
- [ ] Open Feedback and show the actual transcript for that turn.
- [ ] Describe only the timing, transcript, browser-signal, or Raven evidence that is visibly present.
- [ ] If Raven evidence is absent, explicitly say that it is absent.
- [ ] Open Practice, model one exact phrase, and capture at least one real learner attempt.
- [ ] If showing comparison, verify that two distinct learner utterances populated Attempt 1 and Attempt 2.
- [ ] Open Review and show a grounded recap.
- [ ] Show Language Review coverage and its grammar, word choice, natural expression, and polished version sections.
- [ ] End the session on camera and confirm the UI reaches its completed state.

## Live media and lifecycle

- [ ] Microphone permission begins only after Start conversation.
- [ ] The coach can hear the learner through the Daily/Tavus path.
- [ ] Coach audio is audible, including the autoplay recovery path when needed.
- [ ] Camera begins off and can be explicitly enabled and disabled.
- [ ] Mute and unmute change the actual Daily local audio state.
- [ ] Timed sessions begin only after remote coach readiness.
- [ ] The final-minute warning fires once.
- [ ] Manual End and timed End use the same idempotent recap-and-cleanup path.
- [ ] Page exit and connection failure attempt remote conversation cleanup.
- [ ] No known orphaned Tavus room remains after the recording.

## Feedback integrity

- [ ] Transcript counts are not described as acoustic measurements.
- [ ] WPM appears only when duration and enough words are available.
- [ ] Browser waveform and pitch are described as within-turn, auto-scaled signals.
- [ ] No screen or narration calls the waveform a pronunciation, accent, fluency, intonation-correctness, or emotion score.
- [ ] Raven observations are labelled tentative and do not claim inner emotion, personality, intelligence, or ability.
- [ ] The comparison uses only evidence attached to the two captured attempts.
- [ ] Missing evidence remains missing; no placeholder is narrated as a result.
- [ ] The recap's quote or phrase can be traced to the actual session.
- [ ] The polished Language Review preserves names, numbers, links, and meaning from the covered learner turns.

## Local memory and privacy

- [ ] Compact Learning History saves only when the learner opted in before the session and remained opted in at completion.
- [ ] History contains at most 20 finalized compact entries.
- [ ] History can be reviewed, individually deleted, and cleared.
- [ ] Learning Memory saves only after the learner explicitly selects Save for later.
- [ ] “I used it” advances the fixed schedule; “Not quite” schedules a 10-minute retry.
- [ ] Reveal/rehearsal does not advance the review schedule or claim mastery.
- [ ] Progress and History can be opened without creating a Tavus room.
- [ ] No local record contains full transcript, raw audio/video, waveform, pitch contour, Raven observation, API key, or provider token.
- [ ] Language Review and its full learner transcript remain current-tab artifacts rather than compact History fields.

## Optional personalization — verify separately

- [ ] The UI requires explicit identity/voice consent before provider submission.
- [ ] Local recording can be reviewed or discarded without automatic upload.
- [ ] Provider credentials remain server-side.
- [ ] The ElevenLabs account used for the demo is entitled and has sufficient credits/voice slots.
- [ ] A real IVC request returns a provider `voice_id` before calling it successful.
- [ ] Voice Remixing previews and the selected saved variant are verified with the exact submitted account.
- [ ] A Face ID is accepted only after Tavus reports the Face as ready.
- [ ] A personal PAL visibly and audibly uses the intended Face and voice.
- [ ] If any optional step is unverified, the narration labels it as an available integration rather than a completed result.

## Engineering verification

- [ ] `node --check server/static/live.js`
- [ ] `npm test`
- [ ] `python -m pytest -q`
- [ ] `git diff --check`
- [ ] Scan tracked and submission files for key-like strings and authorization headers.
- [ ] Verify that the built artifact corresponds to the submitted source commit.
- [ ] Verify that the deployed page loads the current CSS/JavaScript versions rather than a cached earlier UI.
- [ ] Re-run the live microphone, Face playback, interaction, recap, and cleanup checks after the final deploy.

## Final reviewer handoff

- [ ] The first paragraph explains the product without Tavus jargon.
- [ ] The video demonstrates the product before showing architecture.
- [ ] The architecture explanation stays under 20 seconds in the short demo.
- [ ] The submission explains why Tavus is structurally useful, not just which APIs were called.
- [ ] Known limitations are visible and specific.
- [ ] No unverified result is written in past tense as a completed success.

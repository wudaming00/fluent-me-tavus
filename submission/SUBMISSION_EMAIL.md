# Tavus take-home submission email

**Subject:** Tavus Take-Home Submission — Fluent Me

Hi Ashish and the Tavus team,

Thank you for the opportunity. I’m sharing **Fluent Me**, a conversation-first
English coach built with Tavus CVI. It helps a learner talk naturally with a
responsive video coach, notice one useful thing from a completed turn, practise
one phrase, and leave with a grounded next action.

Submission links:

- **Product walkthrough:** https://fluent-me-tavus-case-study.wudaming00.chatgpt.site/demo/fluent-me-demo.mp4
- **Public case study and architecture:** https://fluent-me-tavus-case-study.wudaming00.chatgpt.site
- **Downloadable case-study PDF:** https://fluent-me-tavus-case-study.wudaming00.chatgpt.site/downloads/fluent-me-case-study.pdf
- **Source repository:** https://github.com/wudaming00/fluent-me-hacknight
- **Exact submitted product-code commit:** https://github.com/wudaming00/fluent-me-hacknight/commit/031fb20c4245e526f9f9f40401a74099036250af
- **Reviewer product access:** Available on request. Reply here and I will share
  controlled access to the exact submitted build; I have not exposed a public
  room-creation link because each live Tavus session uses provider credits and
  concurrency.

The materials cover the requested areas:

1. **The project in action.** The narrated tour uses real captures from a Tavus
   session: the simplified entry and optional setup, an active Tavus Face,
   returned learner transcript, a contextually relevant coach correction,
   focused feedback, and the grounded visual review. The case study labels the
   explicit end path separately rather than presenting a screenshot montage as
   proof of transport or cleanup.
2. **High-level architecture.** The browser owns the custom learning experience
   and joins a Tavus-created private Daily room. A server boundary creates and
   ends conversations while keeping provider credentials out of the browser.
   Tavus combines the PAL’s coaching behavior with the real-time speech
   pipeline, Phoenix Face, Sparrow turn-taking, and bounded Raven perception.
3. **Why I chose this project.** Language practice makes the full conversational
   system structurally useful. The Face is not decoration: it gives the learner
   someone to address and imitate, while live timing, interruption, perception,
   and coaching behavior work together in a way a text correction tool cannot.
4. **My thought process.** I moved from a rigid listen–repeat–fix wizard to one
   open conversation with optional coaching tools. During implementation I
   also separated measured evidence, tentative model perception, and teaching
   guidance; corrected the live media path so Tavus—not a parallel browser
   recorder—is the conversational source of truth; and designed bounded,
   learner-controlled local history and phrase review.

A few deliberate product boundaries are visible in the submission. Browser
waveforms and pitch candidates are descriptive signals, not pronunciation,
accent, emotion, or ability scores. Raven observations remain tentative. The
optional Tavus Face and ElevenLabs voice-personalization paths are
consent-gated and provider-dependent; I do not present them as completed unless
the exact submitted build and account passed the live provider checks shown in
the walkthrough.

I’d be happy to walk through the product decisions, real-time integration, and
what I would validate next.

Best,

Sining Xu

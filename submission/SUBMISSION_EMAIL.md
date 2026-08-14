# Tavus take-home submission email

**Subject:** Tavus Take-Home Submission — Fluent Me

Hi Katya and the Tavus team,

Thank you for the opportunity. I’m sharing **Fluent Me**, a conversation-first
English coach built with Tavus CVI. It helps a learner talk naturally with a
responsive video coach, notice one useful thing from a completed turn, practise
one phrase, and leave with a grounded next action.

Submission links:

- **Product walkthrough:** https://damingwu.com/fluent-me/fluent-me-demo.mp4
- **Public case study and architecture:** https://damingwu.com/fluent-me/
- **Downloadable case-study PDF:** https://damingwu.com/fluent-me/fluent-me-case-study.pdf
- **Source repository:** https://github.com/wudaming00/fluent-me-tavus
- **Exact submitted product-code commit:** https://github.com/wudaming00/fluent-me-tavus/commit/50f68e011455e5d764bfbc1a6bfd3282c6a9cc34
  (the walkthrough video was recorded on
  https://github.com/wudaming00/fluent-me-tavus/commit/031fb20c4245e526f9f9f40401a74099036250af;
  the submitted commit adds the automatic session resume described below, plus the
  public deployment that pins my own Face and cloned voice as the default coach)
- **Live product (try it):** https://fluent-me.wudaming00.workers.dev
  The default coach you'll meet is me — my own trained Phoenix-4 Face speaking
  with my consented ElevenLabs voice clone. Every session runs a real Tavus
  room, so concurrency is limited; if the coach is busy, try again in a minute.

The materials cover the requested areas:

1. **The project in action.** The narrated tour opens with five real captures
   from a Tavus session — the simplified entry and optional setup, an active
   Tavus Face, the returned learner transcript, a contextually relevant coach
   correction, and the grounded visual review — and closes on the public case
   study page while narrating the product's boundaries. The case study labels
   the explicit end path separately rather than presenting a screenshot montage
   as proof of transport or cleanup.
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
   learner-controlled local history and phrase review. When live testing showed
   a Tavus room can be closed mid-session by a plan-level `max_call_duration`
   cap, I made the session survive its room: the client reconnects into a fresh
   room automatically and hands the new room a bounded continuation packet of
   recent turns, so the coach picks the same conversation back up and the focus
   timer keeps accumulating; if the coach cannot return, the session ends
   through the normal recap path instead of stranding the learner.

A few deliberate product boundaries are visible in the submission. Browser
waveforms and pitch candidates are descriptive signals, not pronunciation,
accent, emotion, or ability scores. Raven observations remain tentative. The
Face and voice personalization path is consent-gated and provider-dependent —
and on the live deployment it is exercised end to end: the default coach is my
own trained Face and cloned voice, and the demo narration uses the same clone.

I’d be happy to walk through the product decisions, real-time integration, and
what I would validate next.

Best,

Daming Wu

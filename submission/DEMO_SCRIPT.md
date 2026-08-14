# Fluent Me — 92-second demo narration

The published demo is built deterministically by [build-demo-video.ps1](build-demo-video.ps1)
from real product captures (including a 48-frame live coach-motion sequence), with
narration synthesized in the author's own consented ElevenLabs voice clone by
[synthesize-narration.py](synthesize-narration.py) — the same personalization
path the product offers its learners. The chapter durations below are the
editorial contract enforced by the build; captions and the transcript are
generated from this same text.

| Time | Chapter | Narration |
|---|---|---|
| 0:00–0:10 | Start with one action | Fluent Me is a conversation-first English coach built on Tavus. This narrated tour uses real session captures to show one focused loop. |
| 0:10–0:22 | Continue to start the room | A Tavus room starts only after the learner selects Continue. Topic and time box stay optional, and the coach itself can be created from your own face and voice. |
| 0:22–0:45 | Capture the Tavus room | This is a live Tavus conversation, captured while the coach was responding: Phoenix renders the Face, Sparrow keeps the turns natural, and detailed tools wait in a drawer. The end state is immersion: talking with yourself, in your own face and your own cloned voice, so imitation collapses into repetition. The sequence shows visible coach motion in that interval, not learner-audio transport. |
| 0:45–1:01 | Read the Tavus transcript | After a captured turn, Feedback shows only evidence that exists: the Tavus transcript, timing, counted pauses or repeats, and available microphone or Raven signals. None of it becomes an opaque English score. |
| 1:01–1:18 | Ground one useful change | The grounded review turns available evidence into one useful change. Grammar and wording stay separate from pace and rhythm observations. A phrase worth keeping moves to spaced review, and missing evidence stays hidden rather than guessed. |
| 1:18–1:32 | Document the boundaries | History is opt-in and stays on this device. And a session survives its room: after a provider time cap, the coach reconnects and continues the conversation. Captured motion alone does not prove audio transport or cleanup. |

## Truth rules the build enforces

- Every frame is a real product capture; the script refuses placeholder or generated screens.
- Narration never calls a browser signal a pronunciation, accent, fluency, or emotion score.
- The final chapter states explicitly what the captured motion does not prove.

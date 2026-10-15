# Mascot behavior specification and parity check

This implementation was written independently from observations of a local, noncommercial source application. No source files, comments, artwork, or assets from that application were brought into touri. Rendering and geometry come from the already declared MIT package `@norbert_bodziony/bloub` 0.4.1. The scratch comparison harness imports that installed package directly and never imports or starts the source application.

## Identity

Use a saved avatar seed, otherwise the stable bot ID. The mock bots now use their names as explicit seeds. Hash UTF-16 code units with unsigned 32-bit FNV-1a. Select shapes, expressions, and colors using separate `:shape`, `:expression`, and `:color` suffixes and the engine's catalogue order. A selected `goutte` is replaced by hashing `:shape:replacement` against the seven remaining shapes. Saved unsupported drop choices also fall back to the seeded supported shape.

All sixteen engine expressions participate in automatic resting faces. Automatic colors, in order, are rouge, orange, ambre, vert, turquoise, bleu, violet, rose. Animation phase is the unsigned seed hash divided by 2^32, multiplied by 1.4 seconds.

| Stored hue | Label | Engine color | Hex |
| --- | --- | --- | --- |
| 0 | Red | rouge | #e8483f |
| 30 | Orange | orange | #f08a24 |
| 55 | Yellow | ambre | #f0b429 |
| 100 | Lime | vert | #3ecf8e |
| 150 | Green | vert | #3ecf8e |
| 185 | Cyan | turquoise | #2fbfa0 |
| 215 | Blue | bleu | #3b93f0 |
| 245 | Indigo | violet | #8b5cf6 |
| 280 | Violet | violet | #8b5cf6 |
| 320 | Magenta | rose | #e152b0 |

Lime and Violet remain valid aliases but are omitted from the eight visible color choices. The picker saves palette hex values through touri's existing API; Automatic saves null. Saved picker shapes and colors remain available. Uncustomized old UI accent colors, including #ff8a3d, no longer override automatic identities. Existing explicit custom hex colors on picker identities are retained.

## Mood and motion

| Mood | State | Expression | Contour pulse |
| --- | --- | --- | --- |
| idle | idle | seeded | no |
| working | idle | attentif | yes |
| waiting | idle | curieux | no |
| failed | idle | triste | no |
| responded | idle | heureux | no |
| connecting | swirl | attentif | yes |
| asleep | idle | somnolent | no |

The catalogue states that preserve identity shapes are idle, wink, wide, notify, and swirl. Waiting does not play notify, which would add its own dot. Runtime state projection described below determines the mood, with connecting as a loading override. A reply completed while touri is unfocused remains pleased until focus returns; focused replies briefly celebrate.

Both hover and idle motion policies hold the engine's mood pose until the closest control is hovered or focused. Busy moods, attentive runtime states (listening, waiting-approval, done), always motion, and explicitly enabled pointer following run continuously. A focusable dialog or scroll container does not start every descendant avatar. Leaving interaction restores the held mood pose.

The idle montage is idle, wink, idle, wide, idle. Only the idle holds are multiplied by 1.25, yielding durations 3, 1.6, 3, 1.8, and 3 seconds. A non-idle mood repeats its own state with the same hold multiplier. Frame writes are capped at 30 per second. Clock increments are capped at 0.064 seconds; hidden and offscreen avatars stop and resume from their last time.

Busy mascots pulse their own contour path in the bot’s color over 1.2 seconds. The contour follows the same body frame, with subtle stroke glow and scale from 1 to 1.025. The body and eyes retain their state choreography; there are no orbit engines or electron rings. Activity status uses the same contour even when its body is held still.

Pointer following is opt-in. Relative to each avatar's center, normalize horizontal and vertical distances by 320px and clamp to ±1. Target yaw is 24 times horizontal distance; target pitch is 10 minus 16 times vertical distance. Blend with `1 - exp(-9 * dt)`, with dt limited to 0.1 seconds. Fade mix toward one when a pointer is known, otherwise toward zero; wander is one minus mix, spin is zero. A press adds a damped pitch oscillation for 0.55 seconds: amplitude -14, two sine periods, envelope one minus elapsed fraction. Touch movement is ignored. Listeners are shared and released when unused.

Reduced motion freezes the held mood frame, suppresses pointer following/nods, and leaves a static contour without glow animation or scaling. Photo avatars retain their image with a circular outline matching the photo clip; image errors fall back to generated identity and a changed URL retries the image.

## Runtime states and activity

`MascotMachine` owns a stable snapshot for each bot and each conversation: idle, listening, typing, thinking, working-tool, waiting-approval, error, done, sleeping, or parked. The provider projects existing run, message, notification, computer-grant and composer events into these machines; no database state or schema change is needed. Bot snapshots aggregate their conversations, while the chat avatar and activity line observe the same conversation snapshot.

Paused bots sleep. Pending approvals, questions and takeovers take precedence over active work. Pending tool calls or commands show working-tool; the latest text/reasoning part distinguishes typing from thinking. Terminal runs suppress stale streaming parts and pending message approvals. New work takes precedence over historical failures. An idle, hidden conversation parks; active work retains its state while its animation clock stops.

Fresh completions celebrate for 2.4 seconds, including when the composer retains focus. A background bot reply remains done until window focus returns. Initial history establishes a baseline instead of celebrating past replies. Deadlines are scheduled separately from snapshots, so consecutive completions reschedule the timeout even when the displayed state stays done. All machine timestamps use an injected monotonic clock.

Seeded gaze, acknowledgement nods and periodic wink/blink gestures add attention during runtime activity. Idle hover retains the existing idle/wink/wide montage, and explicit mood previews retain their previous playback. The activity mark beneath a streaming reply carries a pt-BR status phrase beside the bot’s centered mascot. Its body is held still while its own contour pulses during busy states, alongside three activity dots. Waiting for approval removes the dots and can link to the pending approval. Reduced motion holds the outline and dots still with readable status updates, without RAF.

The deterministic harness is `ui/test/fixtures/mascotHarness.ts`; state and integration tests cover transitions, cancellation, history hydration, completion deadlines, visibility and reduced motion. `ui/test/e2e/fixtures/mascot-states.html` exposes all states for browser checks of identity, activity, motion and accessibility.

## Rendering and surfaces

The engine viewBox is 316 by 316 and its body radius is 100. `avatarViewBoxFor` centers each silhouette’s bounds, including asymmetric triangles and clouds. Body and outline SVGs occupy 128% of the avatar box, positioned 14% outside each edge. A neutral rest gaze and zero expression roll keep mascots upright while preserving their eye shapes. Eyes are mask holes over the engine’s #f9f9f9 paper color, including partial opacity and clipping.

Working scales only the contour between 1 and 1.025 over 1.2 seconds with ease-in-out; the avatar tile does not scale. Waiting uses a 3px blue glow (#007cf7), failed uses a 3px red glow (#fd2f3b), and asleep has opacity 0.6. Generated bodies have transparent surroundings and no background tile. Photos use a pill clip, a 6% white background, a 3.5% white inset border, and cover fitting; busy photo clips move to the image so the contour remains visible.

Sidebar boxes are 30px. Chat header boxes are 18px and reflect their conversation’s runtime state. Both use the same centered body/contour registration without surface-specific vertical offsets. Default boxes and notification list boxes are 32px. Other existing touri surfaces retain their explicit sizes. Unread badges sit at right -5px, bottom -3px, with a 16px pill, 2px surrounding border, and a small ambient shadow; they display the unread count.

The source island uses a circular override, 20px compact and stack avatars, 32px row avatars, a -3px optical offset, and a 1px notch-colored border. Touri has no native island renderer to apply those settings to. Its OS notification bridge currently sends title/body without a per-bot image; the generated SVG helper and notification identity serialization are available, but those two native surfaces cannot be verified headlessly as existing touri surfaces.

## Evidence and verification

The committed Vite fixture is `ui/test/e2e/fixtures/mascot-parity.html`: six seeds (mark, onb, Panko, seo, qa-bot, review), seven moods, three sizes (24/32/40px). The independently authored comparison page lives outside the repository at `/tmp/mascot-ref`, uses the installed MIT BloubBot widget, and mirrors the extracted parameters. The screenshot has reference parameters on the left and touri on the right. Animation captures use identical injected RAF timestamps and explicit CSS animation times to avoid differences caused by separate browser clocks.

Final artifacts: `/tmp/touri-evidence/mascot-parity.png`, `/tmp/touri-evidence/mascot-parity.gif`, and `/tmp/touri-evidence/motion-geometry.json`. The harness and temporary captures are not committed. PNG/GIF comparison measurements are recorded in `/tmp/touri-evidence/mascot-parity-metrics.json`.

Required checks: `bun run typecheck`, `bun run lint`, `cd ui && bunx vitest run && bunx playwright test`. The affected sidecar store tests also validate picker persistence and notification serialization. All browser work is headless. No desktop window or screen capture is used.

Measured result: all 8,316 sampled avatar body/eye frames match the independent MIT widget exactly. The frozen PNG differs in three pixels, with a maximum channel difference of 2/255. Across 66 animated captures, the maximum channel difference is 3/255; these are rasterization rounding differences, with matching sampled geometry. Required checks pass (58 Vitest tests and 12 Playwright tests), plus nine affected sidecar store tests. No native island or OS per-bot avatar was added.

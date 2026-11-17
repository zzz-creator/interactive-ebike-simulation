# Council Transcript — 2026-11-17

## Question
Interactive e-bike drivetrain & regenerative braking HTML sim. User asks: "what should we add?" What features/additions would meaningfully improve this lab, and what should we avoid adding?

## Seated
Core five: Contrarian, First Principles Thinker, Expansionist, Outsider, Executor.
Panel: Innovator, Pragmatist, Risk Assessor, Strategist.

## Framed Question
We have an interactive single-page HTML simulation of an e-bike drivetrain and regenerative braking lab (direct-drive hub motor, chain bypass, stationary charge stand, gears, inclines, battery SOC, energy-flow particles, canvas animation; CSS/JS separated, layout fits viewport; hold-to-brake regen button just removed). User asks "what should we add?" What features/additions would meaningfully improve this lab, and what should we avoid adding?

## Advisor Responses
(See council-report-2026-11-17.html for full text of each advisor.)

## Peer Reviews
(See council-report-2026-11-17.html.)

## Chairman Verdict

### Where the Council Agrees
- Fatal defect: regen brake control removed; `state.isBraking` has no UI toggle. Fix first.
- Avoid: 3D, accounts/backend, multiplayer, gamification beyond simple scoring, more gears/visual polish, audio (majority), more controls without removing others. Cognitive load is the binding constraint.
- Quantitative readouts + conservation overlay are table stakes.
- Shareable URL state + localStorage presets universally endorsed.
- No failure containment in single-file canvas app; error boundary + numeric guards needed.
- Physics model unvalidated — no one checked numbers against real e-bike specs.

### Where the Council Clashes
- Monetization (GPX/TCO) vs. pedagogy.
- Scope ordering: features vs. hardening first.
- Audio: split; defer unless trivially toggleable.
- More physics modes vs. distribution focus.

### Blind Spots the Council Caught
- Physics model validation against real measurements.
- Instructor/educator workflow.
- Accessibility (colorblind, reduced-motion, keyboard, ARIA, touch).
- Mobile/touch responsiveness.
- README/assumptions, unit localization.
- Concrete acceptance test / baseline metric.
- rAF failure containment.
- Scope-risk ranking.

### The Recommendation
1. Restore the regen brake control (button + slider + Space key). ~30 lines.
2. Quantitative readouts + conservation overlay.
3. Failure-mode states (BMS cutoff, regen at full charge, chain slip).
4. Shareable URL state + 3 localStorage presets.
5. Error boundary + numeric guards.
6. Accessibility pass.
7. Validate physics model vs. real specs + document assumptions.

Avoid: 3D, audio (unless toggleable), accounts/backend, multiplayer, GPX/fleet TCO until validated, more gears, visual polish, gamification beyond simple scoring, and any feature that doesn't change a student's conclusion.

### The One Thing to Do First
Restore the regen brake control — hold-to-brake button + 0–100% slider + Space key binding, wired to existing `state.isBraking`/`regenForce`.
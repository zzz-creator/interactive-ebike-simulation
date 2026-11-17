# E-Bike Drivetrain & Regenerative Braking Lab

Interactive single-page HTML simulation.

## Physics assumptions (approximate, educational)
- 26" wheel (~0.33m radius); speed conversion rad/s -> km/h = *1.18.
- Battery: 48V Li-Ion, 360 Wh pack, timeScale 28 for visible feedback.
- Regen braking: hub motor acts as dynamo above ~0.3 rad/s wheel speed; disabled at 100% SOC (BMS cutoff).
- Gear ratios 1..5 as defined in GEARS.

## Run
Open the HTML file in a browser. No build step.
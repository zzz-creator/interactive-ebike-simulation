        /**
         * E-Bike Direct Drive, Mechanical Fallback & Regenerative Braking Physics Simulation
         * Architecture:
         * - State-driven physics loop running at 60fps via requestAnimationFrame.
         * - Interactive circular pointer tracking on the crank pedal arm.
         * - Visual schematic renderer with dynamic sprocket sizing, moving chain links,
         *   tilting road horizon for inclines, and directional energy flow particles.
         */

        // ==========================================
        // 1. SIMULATION STATE & CONFIGURATION
        // ==========================================
        const GEARS = {
            1: { teeth: 34, radius: 42, ratio: 0.85, name: "Gear 1 (Climbing)", trait: "Max Torque / Low Speed" },
            2: { teeth: 28, radius: 35, ratio: 1.15, name: "Gear 2 (Low)",      trait: "High Torque" },
            3: { teeth: 22, radius: 28, ratio: 1.50, name: "Gear 3 (Cruise)",   trait: "Balanced Torque/Speed" },
            4: { teeth: 17, radius: 22, ratio: 1.95, name: "Gear 4 (Fast)",     trait: "High Speed" },
            5: { teeth: 13, radius: 17, ratio: 2.50, name: "Gear 5 (Sprint)",   trait: "Max Speed / Low Torque" }
        };

        const state = {
            // Drivetrain Mode: 'hybrid' (direct-drive + regen), 'mechanical' (chain bypass), 'generator' (stand)
            mode: 'hybrid',
            gear: 3,

            // Battery State
            batterySOC: 65.0,       // Percentage (0 to 100)
            batteryCapacityWh: 360, // 360Wh pack (scaled slightly for visible real-time educational feedback)
            timeScale: 28,          // Accelerates battery % delta so user sees charge/discharge clearly

            // Kinematics
            crankAngle: -0.4,       // Radians
            crankAngularVel: 0,     // rad/s
            pedalRPM: 0,
            wheelAngle: 0,          // Radians
            wheelAngularVel: 0,     // rad/s
            wheelSpeedKmh: 0,       // km/h
            roadOffset: 0,          // Pixels for scrolling ground markers

            // Environment & Controls
            inclinePercent: 0,      // -8% downhill, 0% flat, +8% uphill
            visualTiltAngle: 0,     // Smoothly interpolated canvas tilt
            isBraking: false,       // "New Force" regenerative brake active
            autoPedal: false,       // Optional demo auto-pedaling

            // Dragging Interaction
            isDraggingPedal: false,
            lastPointerAngle: 0,
            pedalEffortTorque: 0,   // Instantaneous user input torque (Nm)

            // Telemetry Power Flows (Watts)
            wattsGenerated: 0,      // Pedal gen + Hub regen
            wattsPedalGen: 0,       // From crank dynamo
            wattsHubRegen: 0,       // From rear wheel hub dynamo (downhill / braking)
            wattsConsumed: 0,       // Drawn by rear hub motor
            netWatts: 0,
            motorState: 'Idle',     // 'Assist', 'Regen', 'Charging', 'Mechanical', 'Dead', 'Idle'

            // Energy Flow Particles
            particles: [],
            particleSpawnTimer: 0
        };

        // ==========================================
        // 2. DOM REFERENCES & UI BINDINGS
        // ==========================================
        const canvas = document.getElementById('bikeCanvas');
        const ctx = canvas.getContext('2d');
        const container = document.getElementById('canvasContainer');

        // Telemetry Elements
        const socText = document.getElementById('socText');
        const socBar = document.getElementById('socBar');
        const socDelta = document.getElementById('socDelta');
        const voltageText = document.getElementById('voltageText');
        const genWattsText = document.getElementById('genWattsText');
        const consWattsText = document.getElementById('consWattsText');
        const netWattsBadge = document.getElementById('netWattsBadge');
        const speedText = document.getElementById('speedText');
        const rpmText = document.getElementById('rpmText');
        const gearRatioText = document.getElementById('gearRatioText');
        const motorStatusBadge = document.getElementById('motorStatusBadge');
        const motorStatusDot = document.getElementById('motorStatusDot');
        const motorStatusText = document.getElementById('motorStatusText');
        const inclineLabel = document.getElementById('inclineLabel');
        const calloutText = document.getElementById('calloutText');
        const calloutIcon = document.getElementById('calloutIcon');

        // Mode Switch Buttons
        const modeBtns = document.querySelectorAll('.mode-btn');
        const modeTag = document.getElementById('modeTag');
        const modeDesc = document.getElementById('modeDesc');

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                setDriveMode(btn.dataset.mode);
            });
        });

        function setDriveMode(newMode) {
            state.mode = newMode;
            modeBtns.forEach(b => {
                const isActive = b.dataset.mode === newMode;
                if (isActive) {
                    b.classList.add('active', 'bg-sky-500', 'text-slate-950', 'shadow');
                    b.classList.remove('text-slate-400', 'hover:text-white', 'hover:bg-slate-900');
                } else {
                    b.classList.remove('active', 'bg-sky-500', 'text-slate-950', 'shadow');
                    b.classList.add('text-slate-400', 'hover:text-white', 'hover:bg-slate-900');
                }
            });

            if (newMode === 'hybrid') {
                modeTag.textContent = 'Direct-Drive E-Bike';
                modeDesc.textContent = 'Pedals generate electricity to battery; hub motor drives wheel & harvests regen energy.';
            } else if (newMode === 'mechanical') {
                modeTag.textContent = 'Mechanical Chain Bypass';
                modeDesc.textContent = 'Direct mechanical chain connects pedals to rear sprocket. Works even at 0% battery!';
            } else if (newMode === 'generator') {
                modeTag.textContent = 'Stationary Charge Stand';
                modeDesc.textContent = 'Rear wheel lifted off ground. All pedaling energy goes straight into charging the battery.';
                state.wheelAngularVel *= 0.2;
            }
        }

        // Gear Selector Buttons
        const gearBtns = document.querySelectorAll('.gear-btn');
        const gearTrait = document.getElementById('gearTrait');

        gearBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.gear = parseInt(btn.dataset.gear, 10);
                gearBtns.forEach(b => {
                    const active = parseInt(b.dataset.gear, 10) === state.gear;
                    if (active) {
                        b.classList.add('active', 'bg-amber-500/20', 'border-amber-400', 'text-amber-300', 'shadow-[0_0_12px_rgba(251,191,36,0.2)]');
                        b.classList.remove('bg-slate-950', 'border-slate-800', 'text-slate-300');
                    } else {
                        b.classList.remove('active', 'bg-amber-500/20', 'border-amber-400', 'text-amber-300', 'shadow-[0_0_12px_rgba(251,191,36,0.2)]');
                        b.classList.add('bg-slate-950', 'border-slate-800', 'text-slate-300');
                    }
                });
                const g = GEARS[state.gear];
                gearTrait.textContent = g.trait;
                gearRatioText.textContent = `Ratio ${g.ratio.toFixed(2)}x`;
            });
        });

        // Terrain / Incline Buttons
        const gradeBtns = document.querySelectorAll('.grade-btn');
        const gradeBadge = document.getElementById('gradeBadge');

        gradeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.inclinePercent = parseInt(btn.dataset.grade, 10);
                gradeBtns.forEach(b => {
                    const active = parseInt(b.dataset.grade, 10) === state.inclinePercent;
                    if (active) {
                        b.classList.add('active', 'bg-sky-500/20', 'border-sky-400', 'text-sky-200');
                        b.classList.remove('bg-slate-950', 'border-slate-800');
                    } else {
                        b.classList.remove('active', 'bg-sky-500/20', 'border-sky-400', 'text-sky-200');
                        b.classList.add('bg-slate-950', 'border-slate-800');
                    }
                });

                if (state.inclinePercent > 0) {
                    gradeBadge.textContent = `+${state.inclinePercent}% UPHILL`;
                    gradeBadge.className = 'mono text-[11px] font-bold text-amber-400';
                    inclineLabel.textContent = `Grade: +${state.inclinePercent}% (Uphill)`;
                } else if (state.inclinePercent < 0) {
                    gradeBadge.textContent = `${state.inclinePercent}% DOWNHILL`;
                    gradeBadge.className = 'mono text-[11px] font-bold text-emerald-400';
                    inclineLabel.textContent = `Grade: ${state.inclinePercent}% (Downhill)`;
                } else {
                    gradeBadge.textContent = `0% FLAT`;
                    gradeBadge.className = 'mono text-[11px] font-bold text-slate-300';
                    inclineLabel.textContent = `Grade: 0% (Flat)`;
                }
            });
        });

        // Regen Brake Slider (0-100%) + Hold Button
        const regenBrakeSlider = document.getElementById('regenBrakeSlider');
        const regenBrakeBtn = document.getElementById('regenBrakeBtn');
        const brakeLevelText = document.getElementById('brakeLevelText');
        let brakeSliderLevel = 0;
        regenBrakeSlider.addEventListener('input', () => {
            brakeSliderLevel = parseInt(regenBrakeSlider.value, 10) / 100;
            brakeLevelText.textContent = regenBrakeSlider.value + '%';
        });
        const startBrake = (e) => { if (e) e.preventDefault(); state.isBraking = true; if (regenBrakeBtn) regenBrakeBtn.classList.add('active'); };
        const endBrake = () => { state.isBraking = false; if (regenBrakeBtn) regenBrakeBtn.classList.remove('active'); };
        if (regenBrakeBtn) {
            regenBrakeBtn.addEventListener('mousedown', startBrake);
            regenBrakeBtn.addEventListener('touchstart', startBrake, { passive: false });
        }
        window.addEventListener('mouseup', endBrake);
        window.addEventListener('touchend', endBrake);
        // Keyboard: Space triggers brake when canvas focused
        canvas.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); startBrake(); } });
        canvas.addEventListener('keyup', (e) => { if (e.code === 'Space') { e.preventDefault(); endBrake(); } });
        canvas.tabIndex = 0;

        // Keyboard controls: arrows change grade, 1-5 change gear
        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'ArrowUp') { /* uphill */ const btn = document.querySelector('.grade-btn[data-grade="8"]'); if (btn) btn.click(); }
            if (e.key === 'ArrowDown') { const btn = document.querySelector('.grade-btn[data-grade="-8"]'); if (btn) btn.click(); }
            if (e.key === 'ArrowLeft') { const btn = document.querySelector('.grade-btn[data-grade="0"]'); if (btn) btn.click(); }
            if (/^[1-5]$/.test(e.key)) { const btn = document.querySelector('.gear-btn[data-gear="' + e.key + '"]'); if (btn) btn.click(); }
        });

        // Quick Battery Reset Button
        document.getElementById('quickChargeBtn').addEventListener('click', () => {
            state.batterySOC = 65.0;
        });

        // Auto-Pedal Toggle Button
        const autoPedalBtn = document.getElementById('autoPedalBtn');
        const autoPedalIcon = document.getElementById('autoPedalIcon');
        const autoPedalLabel = document.getElementById('autoPedalLabel');

        autoPedalBtn.addEventListener('click', () => {
            state.autoPedal = !state.autoPedal;
            if (state.autoPedal) {
                autoPedalIcon.className = 'fa-solid fa-pause text-amber-400';
                autoPedalLabel.textContent = 'Stop Auto-Pedal';
                autoPedalBtn.classList.add('border-amber-500/60', 'text-amber-200');
            } else {
                autoPedalIcon.className = 'fa-solid fa-play';
                autoPedalLabel.textContent = 'Auto-Pedal Demo';
                autoPedalBtn.classList.remove('border-amber-500/60', 'text-amber-200');
            }
        });

        // ==========================================
        // 3. CANVAS GEOMETRY & RESPONSIVE SIZING
        // ==========================================
        let layout = {
            width: 800,
            height: 360,
            rearHub: { x: 220, y: 230 },
            crankHub: { x: 430, y: 235 },
            frontHub: { x: 640, y: 230 },
            seatCluster: { x: 360, y: 125 },
            headTubeTop: { x: 565, y: 115 },
            headTubeBot: { x: 580, y: 150 },
            batteryCenter: { x: 472, y: 162 },
            wheelRadius: 72,
            frontChainringRadius: 34,
            crankLength: 56,
            groundY: 304
        };

        function resizeCanvas() {
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            layout.width = rect.width;
            layout.height = rect.height;

            // Responsive bike scaling to fit mobile and desktop cleanly
            const cx = layout.width * 0.5;
            const cy = layout.height * 0.54;
            const scale = Math.min(layout.width / 720, layout.height / 340, 1.18);

            layout.wheelRadius = 70 * scale;
            layout.frontChainringRadius = 33 * scale;
            layout.crankLength = 54 * scale;

            layout.rearHub = { x: cx - 195 * scale, y: cy + 32 * scale };
            layout.crankHub = { x: cx - 5 * scale, y: cy + 38 * scale };
            layout.frontHub = { x: cx + 205 * scale, y: cy + 32 * scale };
            layout.seatCluster = { x: cx - 68 * scale, y: cy - 72 * scale };
            layout.headTubeTop = { x: cx + 132 * scale, y: cy - 80 * scale };
            layout.headTubeBot = { x: cx + 146 * scale, y: cy - 48 * scale };
            layout.batteryCenter = {
                x: (layout.crankHub.x + layout.headTubeBot.x) * 0.5 - 6 * scale,
                y: (layout.crankHub.y + layout.headTubeBot.y) * 0.5 - 10 * scale
            };
            layout.groundY = layout.rearHub.y + layout.wheelRadius + 2;
        }

        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        // ==========================================
        // 4. INTERACTIVE PEDAL DRAGGING (MOUSE & TOUCH)
        // ==========================================
        function getPointerPos(e) {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        }

        function getPedalKnobPos() {
            return {
                x: layout.crankHub.x + Math.cos(state.crankAngle) * layout.crankLength,
                y: layout.crankHub.y + Math.sin(state.crankAngle) * layout.crankLength
            };
        }

        function onPointerDown(e) {
            const pos = getPointerPos(e);
            const pedalPos = getPedalKnobPos();
            const distToPedal = Math.hypot(pos.x - pedalPos.x, pos.y - pedalPos.y);
            const distToCrank = Math.hypot(pos.x - layout.crankHub.x, pos.y - layout.crankHub.y);

            // Allow grabbing either the pedal handle or anywhere along the crank circle
            if (distToPedal < 48 || (distToCrank > 15 && distToCrank < layout.crankLength + 42)) {
                state.isDraggingPedal = true;
                state.autoPedal = false;
                autoPedalIcon.className = 'fa-solid fa-play';
                autoPedalLabel.textContent = 'Auto-Pedal Demo';
                autoPedalBtn.classList.remove('border-amber-500/60', 'text-amber-200');

                state.lastPointerAngle = Math.atan2(pos.y - layout.crankHub.y, pos.x - layout.crankHub.x);
                e.preventDefault();
            }
        }

        function onPointerMove(e) {
            if (!state.isDraggingPedal) return;
            e.preventDefault();
            const pos = getPointerPos(e);
            const currentAngle = Math.atan2(pos.y - layout.crankHub.y, pos.x - layout.crankHub.x);

            let delta = currentAngle - state.lastPointerAngle;
            // Handle angle wrap-around (-PI to PI)
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;

            state.crankAngle += delta;
            // Convert angular step into smooth angular velocity (rad/s)
            const targetVel = delta * 55;
            state.crankAngularVel = state.crankAngularVel * 0.4 + targetVel * 0.6;
            state.lastPointerAngle = currentAngle;
        }

        function onPointerUp() {
            state.isDraggingPedal = false;
        }

        canvas.addEventListener('mousedown', onPointerDown);
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);

        canvas.addEventListener('touchstart', onPointerDown, { passive: false });
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('touchend', onPointerUp);

        // ==========================================
        // 5. PHYSICS & ENERGY FLOW ENGINE
        // ==========================================
        function updatePhysics(dt) {
            const gearSpec = GEARS[state.gear];

            // Auto-pedal demo mode if toggled
            if (state.autoPedal && !state.isDraggingPedal) {
                const targetAutoVel = 6.8; // ~65 RPM
                state.crankAngularVel += (targetAutoVel - state.crankAngularVel) * 5 * dt;
                state.crankAngle += state.crankAngularVel * dt;
            } else if (!state.isDraggingPedal) {
                // Natural crank friction when released
                state.crankAngularVel *= Math.pow(0.06, dt);
                if (Math.abs(state.crankAngularVel) < 0.05) state.crankAngularVel = 0;
                state.crankAngle += state.crankAngularVel * dt;
            }

            // Forward pedaling intensity (only positive/clockwise rotation generates power)
            const forwardCrankVel = Math.max(0, state.crankAngularVel);
            state.pedalRPM = Math.round((forwardCrankVel * 60) / (Math.PI * 2));

            // Reset instantaneous wattage
            state.wattsPedalGen = 0;
            state.wattsHubRegen = 0;
            state.wattsConsumed = 0;

            // Gravitational acceleration along slope (rad/s^2 on wheel)
            // Negative incline = downhill (accelerates wheel), Positive incline = uphill (slows wheel)
            const gravityTorque = -state.inclinePercent * 1.45;
            const rollingDrag = 0.22;
            const aeroDrag = 0.008;

            // --- MODE A: HYBRID DIRECT-DRIVE E-BIKE ---
            if (state.mode === 'hybrid') {
                // 1. Pedals act as a generator charging the battery (scaled by cadence & gear load)
                // Higher gear = higher resistance/power per RPM
                const gearLoadFactor = 0.75 + (gearSpec.ratio * 0.35);
                if (forwardCrankVel > 0.2) {
                    state.wattsPedalGen = Math.min(350, forwardCrankVel * 26 * gearLoadFactor);
                }

                // 2. Check Battery Availability
                const hasBattery = state.batterySOC > 0.2;

                // 3. Rear Hub Motor / Dynamo Logic
                const brakeActive = state.isBraking || brakeSliderLevel > 0;
                const brakeForceScale = state.isBraking ? 1.0 : brakeSliderLevel;
                if (brakeActive && state.wheelAngularVel > 0.3) {
                    // "NEW FORCE" REGENERATIVE BRAKING
                    const regenForce = 24.0 * brakeForceScale;
                    state.wheelAngularVel = Math.max(0, state.wheelAngularVel - regenForce * dt);
                    state.wattsHubRegen = Math.min(480, state.wheelAngularVel * 22 * brakeForceScale);
                    state.motorState = 'Regen Braking';
                } else if (state.inclinePercent < 0) {
                    // DOWNHILL: Gravity spins wheel; hub dynamo harvests rotational energy AND combines with pedaling!
                    state.wheelAngularVel += (gravityTorque - rollingDrag * state.wheelAngularVel * 0.15) * dt;
                    // Gentle speed governance via regenerative drag
                    if (state.wheelAngularVel > 16) {
                        const regenDrag = (state.wheelAngularVel - 16) * 1.6;
                        state.wheelAngularVel -= regenDrag * dt;
                    }
                    if (state.wheelAngularVel > 1.0) {
                        state.wattsHubRegen = Math.min(320, state.wheelAngularVel * 14);
                    }
                    state.motorState = state.wattsPedalGen > 5 ? 'Dual Regen + Pedal' : 'Downhill Regen';
                } else {
                    // FLAT OR UPHILL: Motor drives wheel if rider is pedaling and battery > 0%
                    if (forwardCrankVel > 0.2 && hasBattery) {
                        // Target wheel speed scales with pedal cadence AND selected gear ratio (large -> small sprocket)
                        const targetWheelVel = forwardCrankVel * gearSpec.ratio * 1.35;
                        const uphillMultiplier = state.inclinePercent > 0 ? 1.65 : 1.0;

                        // Hub motor accelerates wheel toward target speed
                        const accel = (targetWheelVel - state.wheelAngularVel) * 3.2;
                        state.wheelAngularVel += (accel + gravityTorque * 0.35) * dt;
                        state.wheelAngularVel = Math.max(0, state.wheelAngularVel);

                        // Power consumed by motor increases sharply uphill and in higher speed gears
                        const baseDraw = forwardCrankVel * 28 * (0.7 + gearSpec.ratio * 0.4) * uphillMultiplier;
                        state.wattsConsumed = Math.min(650, Math.max(40, baseDraw));
                        state.motorState = state.inclinePercent > 0 ? 'High-Torque Assist' : 'Motor Assist';
                    } else if (forwardCrankVel > 0.2 && !hasBattery) {
                        // Battery dead in direct drive! Notify user to switch to Mechanical Chain fallback
                        state.wheelAngularVel += (gravityTorque - rollingDrag * state.wheelAngularVel) * dt;
                        state.wheelAngularVel = Math.max(0, state.wheelAngularVel);
                        state.motorState = 'Battery Empty (Switch to Chain)';
                    } else {
                        // Coasting
                        state.wheelAngularVel += (gravityTorque - rollingDrag * state.wheelAngularVel - aeroDrag * state.wheelAngularVel * state.wheelAngularVel) * dt;
                        state.wheelAngularVel = Math.max(0, state.wheelAngularVel);
                        state.motorState = state.wheelAngularVel > 0.5 ? 'Coasting' : 'Standby';
                    }
                }
            }

            // --- MODE B: MECHANICAL CHAIN BYPASS (WORKS WITH BATTERY OFF/DEAD) ---
            else if (state.mode === 'mechanical') {
                // Direct mechanical chain coupling between front chainring and rear sprocket
                const mechanicalTargetVel = forwardCrankVel * gearSpec.ratio * 1.25;
                // Uphill makes pedaling mechanically harder in high gears (small rear sprocket)
                const climbPenalty = state.inclinePercent > 0 ? (1 / (1 + (state.gear - 1) * 0.22)) : 1.0;

                if (state.isBraking) {
                    state.wheelAngularVel = Math.max(0, state.wheelAngularVel - 26 * dt);
                    state.motorState = 'Mechanical Brake';
                } else if (forwardCrankVel > 0.2) {
                    const effectiveTarget = mechanicalTargetVel * climbPenalty;
                    state.wheelAngularVel += (effectiveTarget - state.wheelAngularVel) * 4.5 * dt;
                    state.motorState = 'Chain Drive (Motor Off)';
                } else {
                    // Freewheel coasting
                    state.wheelAngularVel += (gravityTorque - rollingDrag * state.wheelAngularVel) * dt;
                    state.wheelAngularVel = Math.max(0, state.wheelAngularVel);
                    state.motorState = 'Freewheel Coast';
                }
            }

            // --- MODE C: STATIONARY GENERATOR STAND ---
            else if (state.mode === 'generator') {
                // Rear wheel is lifted off ground; crank generator charges battery directly
                state.wheelAngularVel *= Math.pow(0.15, dt);
                if (forwardCrankVel > 0.2) {
                    const gearEfficiency = 0.8 + (gearSpec.ratio * 0.35);
                    state.wattsPedalGen = Math.min(420, forwardCrankVel * 34 * gearEfficiency);
                    state.motorState = 'Stand Charging';
                } else {
                    state.motorState = 'Standby (Lifted)';
                }
            }

            // Integrate wheel rotation & forward ground travel
            state.wheelAngle += state.wheelAngularVel * dt;
            // Realistic speed conversion: 26" wheel (~0.33m radius) -> rad/s * 0.33 * 3.6
            state.wheelSpeedKmh = state.mode === 'generator' ? 0 : Math.max(0, state.wheelAngularVel * 1.18);
            state.roadOffset = (state.roadOffset + state.wheelAngularVel * layout.wheelRadius * dt) % 80;

            // BMS: disable regen charging when battery is full
            if (state.batterySOC >= 100 && state.wattsHubRegen > 0) {
                state.wattsHubRegen = 0;
                state.motorState = 'BATTERY FULL - Regen Disabled';
            }
            // Update Net Power & Battery SOC (%)
            state.wattsGenerated = state.wattsPedalGen + state.wattsHubRegen;
            state.netWatts = state.wattsGenerated - state.wattsConsumed;

            const whDelta = (state.netWatts * (dt / 3600)) * state.timeScale;
            const socPercentChange = (whDelta / state.batteryCapacityWh) * 100;
            state.batterySOC = Math.max(0, Math.min(100, state.batterySOC + socPercentChange));

            // Smooth incline visual tilt
            const targetTilt = (-state.inclinePercent * 0.9) * (Math.PI / 180);
            state.visualTiltAngle += (targetTilt - state.visualTiltAngle) * 6 * dt;

            // Update Energy Flow Particles
            updateParticles(dt);

            // Sync Telemetry UI
            updateTelemetryUI(socPercentChange / dt);
        }

        // ==========================================
        // 6. ENERGY FLOW PARTICLES (WIRING ANIMATION)
        // ==========================================
        function updateParticles(dt) {
            const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduced) { state.particles = []; return; }
            state.particleSpawnTimer += dt;

            // 1. Pedal Generator -> Battery (Green/Emerald)
            if (state.wattsPedalGen > 10 && state.particleSpawnTimer > 0.14) {
                state.particles.push({
                    path: 'pedalToBattery',
                    t: 0,
                    speed: 0.9 + (state.wattsPedalGen / 350) * 0.9,
                    color: '#34d399',
                    size: 4.5
                });
            }

            // 2. Battery -> Rear Hub Motor (Amber/Orange Discharge)
            if (state.wattsConsumed > 10 && state.particleSpawnTimer > 0.13) {
                state.particles.push({
                    path: 'batteryToHub',
                    t: 0,
                    speed: 0.95 + (state.wattsConsumed / 450) * 1.1,
                    color: '#fbbf24',
                    size: 4.8
                });
            }

            // 3. Rear Hub Dynamo -> Battery ("New Force" Regen / Downhill Charging - Cyan/Emerald)
            if (state.wattsHubRegen > 10 && state.particleSpawnTimer > 0.12) {
                state.particles.push({
                    path: 'hubToBattery',
                    t: 0,
                    speed: 1.0 + (state.wattsHubRegen / 400) * 1.1,
                    color: '#22d3ee',
                    size: 5.0
                });
            }

            if (state.particleSpawnTimer > 0.14) {
                state.particleSpawnTimer = 0;
            }

            // Advance & prune particles
            for (let i = state.particles.length - 1; i >= 0; i--) {
                const p = state.particles[i];
                p.t += p.speed * dt;
                if (p.t >= 1) {
                    state.particles.splice(i, 1);
                }
            }
        }

        // ==========================================
        // 7. TELEMETRY & CALLOUT UI UPDATES
        // ==========================================
        function updateTelemetryUI(socRatePerSec) {
            // Battery SOC & Voltage (42V empty -> 54.6V full)
            socText.textContent = `${state.batterySOC.toFixed(1)}%`;
            socBar.style.width = `${state.batterySOC}%`;
            const voltage = 42.0 + (state.batterySOC / 100) * 12.6;
            voltageText.textContent = `${voltage.toFixed(1)}V`;

            if (state.batterySOC <= 15) {
                socText.className = 'mono text-lg sm:text-xl font-bold text-rose-400';
                socBar.className = 'h-full bg-rose-500 transition-all duration-150';
            } else if (state.batterySOC <= 35) {
                socText.className = 'mono text-lg sm:text-xl font-bold text-amber-400';
                socBar.className = 'h-full bg-amber-400 transition-all duration-150';
            } else {
                socText.className = 'mono text-lg sm:text-xl font-bold text-emerald-400';
                socBar.className = 'h-full bg-gradient-to-r from-emerald-500 to-teal-300 transition-all duration-150';
            }

            const sign = socRatePerSec > 0.01 ? '+' : '';
            socDelta.textContent = `${sign}${socRatePerSec.toFixed(2)}%/s`;
            socDelta.className = socRatePerSec > 0.01 ? 'mono text-[11px] text-emerald-400' : (socRatePerSec < -0.01 ? 'mono text-[11px] text-amber-400' : 'mono text-[11px] text-slate-400');

            // Watts Generated vs Consumed
            genWattsText.textContent = `+${Math.round(state.wattsGenerated)} W`;
            consWattsText.textContent = `-${Math.round(state.wattsConsumed)} W`;

            const net = Math.round(state.netWatts);
            netWattsBadge.textContent = `NET ${net >= 0 ? '+' : ''}${net}W`;
            if (net > 5) {
                netWattsBadge.className = 'mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
            } else if (net < -5) {
                netWattsBadge.className = 'mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30';
            } else {
                netWattsBadge.className = 'mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300';
            }

            // Speed & RPM
            speedText.textContent = state.wheelSpeedKmh.toFixed(1);
            rpmText.textContent = state.pedalRPM;

            // Motor / Dynamo Status Badge
            motorStatusText.textContent = state.motorState;
            if (state.motorState.includes('Regen') || state.motorState.includes('Charging')) {
                motorStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
                motorStatusBadge.className = 'inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-xs sm:text-sm font-semibold text-emerald-300';
            } else if (state.motorState.includes('Assist')) {
                motorStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
                motorStatusBadge.className = 'inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-950/80 border border-amber-500/40 text-xs sm:text-sm font-semibold text-amber-300';
            } else if (state.motorState.includes('Empty')) {
                motorStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
                motorStatusBadge.className = 'inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/40 text-xs sm:text-sm font-semibold text-rose-300';
            } else {
                motorStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-sky-400';
                motorStatusBadge.className = 'inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs sm:text-sm font-semibold text-slate-200';
            }

            // Efficiency readouts + conservation check
            const effEl = document.getElementById('effText');
            const consBadge = document.getElementById('conservationBadge');
            if (effEl) {
                const motorEff = state.wattsConsumed > 0 ? Math.round((state.wheelAngularVel * 10) / state.wattsConsumed * 100) : 0;
                const driveEff = 92;
                const regenEff = state.wattsHubRegen > 0 ? Math.round((state.wattsHubRegen / Math.max(1, state.wheelAngularVel * 22)) * 100) : 0;
                effEl.textContent = `${Math.min(100,motorEff)}/${driveEff}/${Math.min(100,regenEff)} %`;
            }
            if (consBadge) {
                const gen = state.wattsGenerated, cons = state.wattsConsumed;
                const ok = Math.abs(gen - cons) < Math.max(5, gen * 0.15 + 5);
                consBadge.textContent = ok ? 'Conservation: OK' : 'Conservation: CHECK';
                consBadge.className = ok ? 'ml-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300' : 'ml-2 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300';
            }

            // Dynamic Educational Callout Explanation
            updateEducationalCallout();
        }

        function updateEducationalCallout() {
            if (state.isBraking && state.wattsHubRegen > 5) {
                calloutIcon.className = 'fa-solid fa-bolt text-cyan-400 shrink-0';
                calloutText.textContent = `"New Force" Regen Braking: Rear hub motor acts as a dynamo, converting wheel momentum back into +${Math.round(state.wattsHubRegen)}W!`;
            } else if (state.mode === 'hybrid' && state.inclinePercent < 0 && state.wattsHubRegen > 5) {
                calloutIcon.className = 'fa-solid fa-arrow-trend-down text-emerald-400 shrink-0';
                calloutText.textContent = `Downhill Energy Harvest: Combining hub dynamo regen (+${Math.round(state.wattsHubRegen)}W) + your pedaling (+${Math.round(state.wattsPedalGen)}W) into the battery!`;
            } else if (state.mode === 'hybrid' && state.inclinePercent > 0 && state.wattsConsumed > 10) {
                calloutIcon.className = 'fa-solid fa-arrow-trend-up text-amber-400 shrink-0';
                calloutText.textContent = `Uphill Assist: Gravity adds resistance; hub motor draws -${Math.round(state.wattsConsumed)}W from the battery to help you climb.`;
            } else if (state.mode === 'hybrid' && state.batterySOC <= 0.2) {
                calloutIcon.className = 'fa-solid fa-triangle-exclamation text-rose-400 shrink-0';
                calloutText.textContent = `Battery Depleted (0%)! Switch Drivetrain Mode to "Chain Only" to keep riding mechanically.`;
            } else if (state.mode === 'mechanical') {
                calloutIcon.className = 'fa-solid fa-link text-sky-400 shrink-0';
                calloutText.textContent = `Mechanical Chain Mode: Direct sprocket coupling (${GEARS[state.gear].name}). Zero battery needed!`;
            } else if (state.mode === 'generator') {
                calloutIcon.className = 'fa-solid fa-charging-station text-emerald-400 shrink-0';
                calloutText.textContent = `Stationary Charge Stand: Wheel lifted off ground. Pedaling generates +${Math.round(state.wattsPedalGen)}W straight into the battery.`;
            } else if (state.pedalRPM > 5) {
                calloutIcon.className = 'fa-solid fa-gauge-high text-sky-400 shrink-0';
                calloutText.textContent = `${GEARS[state.gear].name}: Pedals charge battery (+${Math.round(state.wattsPedalGen)}W) while hub motor drives wheel (-${Math.round(state.wattsConsumed)}W).`;
            } else {
                calloutIcon.className = 'fa-solid fa-hand-pointer text-sky-400 shrink-0';
                calloutText.textContent = `Drag the glowing pedal handle in a circle to spin the crank, or click "Auto-Pedal Demo".`;
            }
        }

        // ==========================================
        // 8. 2D SCHEMATIC RENDERER
        // ==========================================
        function drawBike() {
            const w = layout.width;
            const h = layout.height;
            ctx.clearRect(0, 0, w, h);

            ctx.save();
            // Rotate entire road + bike scene subtly around crank center to visualize Uphill / Downhill slope
            ctx.translate(layout.crankHub.x, layout.crankHub.y);
            ctx.rotate(state.visualTiltAngle);
            ctx.translate(-layout.crankHub.x, -layout.crankHub.y);

            // 1. Draw Ground / Road Surface & Moving Speed Markers
            drawGround();

            // 2. If in Stationary Charge Stand mode, draw a rear service stand lifting the rear wheel
            if (state.mode === 'generator') {
                drawChargeStand();
            }

            // 3. Draw Rear & Front Wheels + Hub Motor/Dynamo Core
            drawWheel(layout.rearHub.x, layout.rearHub.y, layout.wheelRadius, state.wheelAngle, true);
            drawWheel(layout.frontHub.x, layout.frontHub.y, layout.wheelRadius, state.wheelAngle, false);

            // 4. Draw Chain & Sprockets (Rear Gear changes size dynamically!)
            const rearGearRadius = GEARS[state.gear].radius * (layout.wheelRadius / 70);
            drawChainAndSprockets(rearGearRadius);

            // 5. Draw Diamond Bicycle Frame
            drawFrame();

            // 6. Draw Frame-Mounted Battery Pack with Live Charge Bar
            drawBatteryPack();

            // 7. Draw Electrical Wiring Paths & Animated Energy Flow Particles
            drawWiringAndParticles();

            // 8. Draw Interactive Movable Crank Arm & Grab Handle
            drawCrankAndPedal();

            // 9. Draw Component Callout Labels
            drawLabels();

            ctx.restore();
        }

        function drawGround() {
            const gy = layout.groundY;
            // Subtle road gradient below ground line
            const grad = ctx.createLinearGradient(0, gy, 0, gy + 70);
            grad.addColorStop(0, 'rgba(30, 41, 59, 0.85)');
            grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(-150, gy, layout.width + 300, 80);

            // Main road surface line
            ctx.beginPath();
            ctx.moveTo(-150, gy);
            ctx.lineTo(layout.width + 150, gy);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Moving dashed road ticks to convey speed & direction
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 2;
            const spacing = 80;
            for (let x = -spacing - state.roadOffset; x < layout.width + spacing; x += spacing) {
                ctx.beginPath();
                ctx.moveTo(x, gy + 12);
                ctx.lineTo(x + 28, gy + 12);
                ctx.stroke();
            }
        }

        function drawChargeStand() {
            const rx = layout.rearHub.x;
            const ry = layout.rearHub.y;
            const gy = layout.groundY;

            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(rx - 28, gy);
            ctx.lineTo(rx, ry + 6);
            ctx.lineTo(rx + 28, gy);
            ctx.moveTo(rx - 36, gy);
            ctx.lineTo(rx + 36, gy);
            ctx.stroke();
        }

        function drawWheel(cx, cy, r, angle, isRearHubMotor) {
            // Lift rear wheel slightly visually when on Charge Stand
            const offsetY = (isRearHubMotor && state.mode === 'generator') ? -14 : 0;
            const y = cy + offsetY;

            // Tire
            ctx.beginPath();
            ctx.arc(cx, y, r, 0, Math.PI * 2);
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 10;
            ctx.stroke();

            // Rim
            ctx.beginPath();
            ctx.arc(cx, y, r - 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Rotating Spokes
            ctx.save();
            ctx.translate(cx, y);
            ctx.rotate(angle);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
            ctx.lineWidth = 1.5;
            const spokeCount = 12;
            for (let i = 0; i < spokeCount; i++) {
                const a = (i / spokeCount) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6));
                ctx.stroke();
            }

            // Tire rotation indicator marker
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(r - 5, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Hub Center (Rear has Direct-Drive Hub Motor / Dynamo)
            if (isRearHubMotor) {
                const hubR = r * 0.36;
                // Glow based on active motor/dynamo state
                if (state.wattsHubRegen > 5) {
                    ctx.shadowColor = '#22d3ee';
                    ctx.shadowBlur = 18;
                } else if (state.wattsConsumed > 5) {
                    ctx.shadowColor = '#fbbf24';
                    ctx.shadowBlur = 18;
                }

                ctx.beginPath();
                ctx.arc(cx, y, hubR, 0, Math.PI * 2);
                ctx.fillStyle = '#0f172a';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = state.wattsHubRegen > 5 ? '#22d3ee' : (state.wattsConsumed > 5 ? '#fbbf24' : '#475569');
                ctx.stroke();
                ctx.shadowBlur = 0;

                // Copper stator windings inside hub motor
                ctx.save();
                ctx.translate(cx, y);
                ctx.rotate(-angle * 0.5);
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2;
                    ctx.fillStyle = state.wattsHubRegen > 5 ? '#22d3ee' : '#f59e0b';
                    ctx.beginPath();
                    ctx.arc(Math.cos(a) * (hubR * 0.58), Math.sin(a) * (hubR * 0.58), 2.5, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            } else {
                // Standard front hub
                ctx.beginPath();
                ctx.arc(cx, y, 8, 0, Math.PI * 2);
                ctx.fillStyle = '#334155';
                ctx.fill();
            }
        }

        function drawChainAndSprockets(rearR) {
            const offsetY = (state.mode === 'generator') ? -14 : 0;
            const rx = layout.rearHub.x;
            const ry = layout.rearHub.y + offsetY;
            const cx = layout.crankHub.x;
            const cy = layout.crankHub.y;
            const frontR = layout.frontChainringRadius;

            // Highlight chain when Mechanical Chain Mode is active
            const isChainActive = state.mode === 'mechanical';
            const chainColor = isChainActive ? '#38bdf8' : 'rgba(148, 163, 184, 0.45)';

            // Tangent lines for top & bottom chain runs
            const dx = cx - rx;
            const dy = cy - ry;
            const dist = Math.hypot(dx, dy);
            const baseAngle = Math.atan2(dy, dx);
            const alpha = Math.asin(Math.max(-0.9, Math.min(0.9, (frontR - rearR) / dist)));

            const topAngle = baseAngle - Math.PI / 2 + alpha;
            const botAngle = baseAngle + Math.PI / 2 - alpha;

            ctx.save();
            ctx.strokeStyle = chainColor;
            ctx.lineWidth = isChainActive ? 3.5 : 2.5;
            ctx.setLineDash([6, 4]);
            // Animate chain link dash offset with crank/wheel rotation
            ctx.lineDashOffset = -(state.crankAngle * frontR);

            // Top chain span
            ctx.beginPath();
            ctx.moveTo(rx + Math.cos(topAngle) * rearR, ry + Math.sin(topAngle) * rearR);
            ctx.lineTo(cx + Math.cos(topAngle) * frontR, cy + Math.sin(topAngle) * frontR);
            ctx.stroke();

            // Bottom chain span
            ctx.beginPath();
            ctx.moveTo(rx + Math.cos(botAngle) * rearR, ry + Math.sin(botAngle) * rearR);
            ctx.lineTo(cx + Math.cos(botAngle) * frontR, cy + Math.sin(botAngle) * frontR);
            ctx.stroke();
            ctx.restore();

            // Rear Sprocket (dynamically sized by selected gear 1..5!)
            drawSprocket(rx, ry, rearR, GEARS[state.gear].teeth, state.wheelAngle, '#f59e0b');

            // Front Chainring + Pedal Generator Core
            drawSprocket(cx, cy, frontR, 32, state.crankAngle, '#38bdf8');
        }

        function drawSprocket(x, y, radius, teeth, angle, accentColor) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);

            ctx.beginPath();
            const step = (Math.PI * 2) / teeth;
            for (let i = 0; i < teeth; i++) {
                const a1 = i * step;
                const a2 = a1 + step * 0.5;
                ctx.lineTo(Math.cos(a1) * (radius + 2.5), Math.sin(a1) * (radius + 2.5));
                ctx.lineTo(Math.cos(a2) * (radius - 1.5), Math.sin(a2) * (radius - 1.5));
            }
            ctx.closePath();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = accentColor;
            ctx.stroke();

            // Inner ring cutouts
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.restore();
        }

        function drawFrame() {
            const offsetY = (state.mode === 'generator') ? -14 : 0;
            const rHub = { x: layout.rearHub.x, y: layout.rearHub.y + offsetY };
            const cHub = layout.crankHub;
            const fHub = layout.frontHub;
            const seat = layout.seatCluster;
            const headT = layout.headTubeTop;
            const headB = layout.headTubeBot;

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Main Frame Tubes
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 6;
            ctx.beginPath();
            // Rear triangle
            ctx.moveTo(rHub.x, rHub.y);
            ctx.lineTo(seat.x, seat.y);
            ctx.lineTo(cHub.x, cHub.y);
            ctx.lineTo(rHub.x, rHub.y);
            // Front triangle
            ctx.moveTo(seat.x, seat.y);
            ctx.lineTo(headT.x, headT.y);
            ctx.lineTo(headB.x, headB.y);
            ctx.lineTo(cHub.x, cHub.y);
            ctx.stroke();

            // Front Fork
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(headT.x, headT.y);
            ctx.lineTo(fHub.x, fHub.y);
            ctx.stroke();

            // Seatpost & Saddle
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(seat.x, seat.y);
            ctx.lineTo(seat.x - 10, seat.y - 24);
            ctx.stroke();

            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(seat.x - 32, seat.y - 31, 44, 10, 5);
            ctx.fill();
            ctx.stroke();

            // Handlebars
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(headT.x, headT.y);
            ctx.lineTo(headT.x - 6, headT.y - 22);
            ctx.lineTo(headT.x + 14, headT.y - 24);
            ctx.stroke();
        }

        function drawBatteryPack() {
            const bx = layout.batteryCenter.x;
            const by = layout.batteryCenter.y;
            const angle = Math.atan2(layout.headTubeBot.y - layout.crankHub.y, layout.headTubeBot.x - layout.crankHub.x);

            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(angle);

            const bw = 78;
            const bh = 24;

            // Battery Housing
            ctx.fillStyle = '#0f172a';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 6);
            ctx.fill();
            ctx.stroke();

            // Battery Terminal Nub
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(bw / 2, -5, 4, 10);

            // Live SOC Fill Level inside battery casing
            const fillW = Math.max(0, (bw - 8) * (state.batterySOC / 100));
            ctx.fillStyle = state.batterySOC <= 15 ? '#f43f5e' : (state.batterySOC <= 35 ? '#fbbf24' : '#10b981');
            ctx.beginPath();
            ctx.roundRect(-bw / 2 + 4, -bh / 2 + 4, fillW, bh - 8, 3);
            ctx.fill();

            // Bolt icon / text on battery
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px JetBrains Mono';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${Math.round(state.batterySOC)}%`, 0, 0.5);

            ctx.restore();
        }

        function drawWiringAndParticles() {
            const offsetY = (state.mode === 'generator') ? -14 : 0;
            const rHub = { x: layout.rearHub.x, y: layout.rearHub.y + offsetY };
            const cHub = layout.crankHub;
            const bat = layout.batteryCenter;
            const seat = layout.seatCluster;

            // Draw subtle electrical bus conduits
            ctx.save();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);

            // Path 1: Crank Generator <-> Battery
            ctx.beginPath();
            ctx.moveTo(cHub.x, cHub.y);
            ctx.lineTo(bat.x, bat.y);
            ctx.stroke();

            // Path 2: Battery <-> Seat Cluster <-> Rear Hub Motor
            ctx.beginPath();
            ctx.moveTo(bat.x, bat.y);
            ctx.lineTo(seat.x, seat.y + 8);
            ctx.lineTo(rHub.x, rHub.y);
            ctx.stroke();
            ctx.restore();

            // Render Glowing Energy Flow Particles
            state.particles.forEach(p => {
                let pos = { x: 0, y: 0 };
                if (p.path === 'pedalToBattery') {
                    pos.x = cHub.x + (bat.x - cHub.x) * p.t;
                    pos.y = cHub.y + (bat.y - cHub.y) * p.t;
                } else if (p.path === 'batteryToHub') {
                    pos = sampleTwoSegmentPath(bat, { x: seat.x, y: seat.y + 8 }, rHub, p.t);
                } else if (p.path === 'hubToBattery') {
                    pos = sampleTwoSegmentPath(rHub, { x: seat.x, y: seat.y + 8 }, bat, p.t);
                }

                ctx.save();
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 12;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
                ctx.fill();

                // Bright white core
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, p.size * 0.42, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
        }

        function sampleTwoSegmentPath(p0, p1, p2, t) {
            if (t < 0.45) {
                const localT = t / 0.45;
                return {
                    x: p0.x + (p1.x - p0.x) * localT,
                    y: p0.y + (p1.y - p0.y) * localT
                };
            } else {
                const localT = (t - 0.45) / 0.55;
                return {
                    x: p1.x + (p2.x - p1.x) * localT,
                    y: p1.y + (p2.y - p1.y) * localT
                };
            }
        }

        function drawCrankAndPedal() {
            const cx = layout.crankHub.x;
            const cy = layout.crankHub.y;
            const knob = getPedalKnobPos();

            // Subtle circular drag guide track around crank
            ctx.beginPath();
            ctx.arc(cx, cy, layout.crankLength, 0, Math.PI * 2);
            ctx.strokeStyle = state.isDraggingPedal ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.16)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Directional rotation cue arrow on the circle when idle
            if (state.pedalRPM < 5 && !state.isDraggingPedal) {
                const cueAngle = state.crankAngle + 0.55;
                const ax = cx + Math.cos(cueAngle) * layout.crankLength;
                const ay = cy + Math.sin(cueAngle) * layout.crankLength;
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(cueAngle + Math.PI / 2);
                ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
                ctx.beginPath();
                ctx.moveTo(6, 0);
                ctx.lineTo(-5, -5);
                ctx.lineTo(-5, 5);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Crank Arm
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 7;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(knob.x, knob.y);
            ctx.stroke();

            // Crank Center Spindle
            ctx.beginPath();
            ctx.arc(cx, cy, 9, 0, Math.PI * 2);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#38bdf8';
            ctx.stroke();

            // Interactive Draggable Pedal Grab Ring
            const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.12;
            ctx.save();
            ctx.beginPath();
            ctx.arc(knob.x, knob.y, 19 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = state.isDraggingPedal ? 'rgba(56, 189, 248, 0.35)' : 'rgba(56, 189, 248, 0.18)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#38bdf8';
            ctx.stroke();

            // Pedal Platform
            ctx.fillStyle = '#0f172a';
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(knob.x - 14, knob.y - 6, 28, 12, 4);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        function drawLabels() {
            const offsetY = (state.mode === 'generator') ? -14 : 0;
            ctx.font = '600 11px Inter';
            ctx.textAlign = 'center';

            // Rear Hub Motor/Dynamo Label
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('Hub Motor / Dynamo', layout.rearHub.x, layout.rearHub.y + offsetY - layout.wheelRadius - 18);
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(`Gear ${state.gear} (${GEARS[state.gear].teeth}T)`, layout.rearHub.x, layout.rearHub.y + offsetY - layout.wheelRadius - 5);

            // Battery Pack Label
            ctx.fillStyle = '#34d399';
            ctx.fillText('48V Li-Ion Battery', layout.batteryCenter.x - 18, layout.batteryCenter.y - 26);

            // Pedal Generator Label
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('Drag Pedal Crank', layout.crankHub.x, layout.groundY + 24);
        }

        // ==========================================
        // 9. MAIN ANIMATION LOOP
        // ==========================================
        let lastTime = performance.now();

        function animate(now) {
            let dt = (now - lastTime) / 1000;
            if (dt < 1/120) dt = 1/120;
            if (dt > 0.05) dt = 0.05;
            lastTime = now;

            const banner = document.getElementById('simBanner');
            try {
                state.wheelAngularVel = Math.max(-50, Math.min(50, state.wheelAngularVel));
                updatePhysics(dt);
                drawBike();
            } catch (err) {
                if (banner) { banner.classList.remove('hidden'); banner.textContent = 'Simulation paused — ' + (err && err.message ? err.message : 'error'); }
                return;
            }
            if (banner) banner.classList.add('hidden');

            requestAnimationFrame(animate);
        }

        window.onload = function () {
            resizeCanvas();
            setDriveMode('hybrid');
            requestAnimationFrame(animate);
        };

/* ═══════════════ Replay Engine ═══════════════ */

const ReplayEngine = {
    baseData: [],
    currentTF: 60,
    replayIndex: 0,
    isPlaying: false,
    speed: 1,
    _timer: null,
    _userScrolled: false,
    openOnly: false, // When true, show only the open price of the current candle
    indicatorState: { sma: true, ema: false, bb: false, rsi: false, macd: false, vol: true },

    // Sub-candle mode: when speed < 1x, step through base candles one at a time
    // so the current aggregated candle builds up progressively
    _subMode: false,
    _baseIdx: 0,

    dom: {},

    init() {
        this.dom = {
            playBtn: document.getElementById('btn-play'),
            speedSlider: document.getElementById('speed-slider'),
            speedLabel: document.getElementById('speed-label'),
            progressBar: document.getElementById('progress-bar'),
            barCounter: document.getElementById('bar-counter'),
            datetime: document.getElementById('current-datetime'),
        };

        this.dom.speedSlider.addEventListener('input', () => {
            this.speed = parseFloat(this.dom.speedSlider.value);
            this._updateSpeedLabel();
            this._syncSubMode();
            if (this.isPlaying) this._restartTimer();
        });

        this.dom.progressBar.addEventListener('input', () => {
            const total = this._getAgg().length;
            this.replayIndex = Math.round((parseInt(this.dom.progressBar.value) / 100) * (total - 1));
            // Sync base index to end of this aggregated candle
            if (this._subMode) {
                this._baseIdx = aggregatedIndexToBaseIndex(this.baseData, this.currentTF, this.replayIndex);
            }
            this._renderFrame(false);
        });

        document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
        document.getElementById('btn-step-fwd').addEventListener('click', () => this.stepForward());
        document.getElementById('btn-step-back').addEventListener('click', () => this.stepBack());
        document.getElementById('btn-to-start').addEventListener('click', () => this.goToStart());
        document.getElementById('btn-to-end').addEventListener('click', () => this.goToEnd());

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.code) {
                case 'Space': e.preventDefault(); this.togglePlay(); break;
                case 'ArrowRight': e.preventDefault(); this.stepForward(); break;
                case 'ArrowLeft': e.preventDefault(); this.stepBack(); break;
                case 'Equal': case 'NumpadAdd':
                    e.preventDefault();
                    this.speed = Math.min(20, +(this.speed + (this.speed < 1 ? 0.1 : 0.5)).toFixed(1));
                    this.dom.speedSlider.value = this.speed;
                    this._updateSpeedLabel();
                    this._syncSubMode();
                    if (this.isPlaying) this._restartTimer();
                    break;
                case 'Minus': case 'NumpadSubtract':
                    e.preventDefault();
                    this.speed = Math.max(0.1, +(this.speed - (this.speed <= 1 ? 0.1 : 0.5)).toFixed(1));
                    this.dom.speedSlider.value = this.speed;
                    this._updateSpeedLabel();
                    this._syncSubMode();
                    if (this.isPlaying) this._restartTimer();
                    break;
                case 'Home': e.preventDefault(); this.goToStart(); break;
                case 'End': e.preventDefault(); this.goToEnd(); break;
            }
        });
    },

    _updateSpeedLabel() {
        if (this.speed < 1 && this.currentTF > 5) {
            // Show sub-candle indicator
            this.dom.speedLabel.textContent = this.speed.toFixed(1) + '× (sub)';
        } else {
            this.dom.speedLabel.textContent = (this.speed % 1 === 0 ? this.speed : this.speed.toFixed(1)) + '×';
        }
    },

    /** Enter or exit sub-candle mode based on current speed and timeframe. */
    _syncSubMode() {
        const shouldBeSub = this.speed < 1 && this.currentTF > 5;

        if (shouldBeSub && !this._subMode) {
            // Entering sub-mode: convert replayIndex to base index
            this._subMode = true;
            this._baseIdx = aggregatedIndexToBaseIndex(this.baseData, this.currentTF, this.replayIndex);
        } else if (!shouldBeSub && this._subMode) {
            // Exiting sub-mode: convert base index to agg index
            this._subMode = false;
            this.replayIndex = baseIndexToAggregatedIndex(this.baseData, this.currentTF, this._baseIdx);
        }
    },

    loadData(data, tf) {
        this.pause();
        this.baseData = data;
        this.currentTF = tf || 60;
        this.replayIndex = 0;
        this._baseIdx = 0;
        this._syncSubMode();
        this._renderFrame(true);
    },

    switchTimeframe(newTF) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) this.pause();
        const oldAgg = this._getAgg();
        const currentTime = (oldAgg[this.replayIndex] || {}).time || 0;
        this.currentTF = newTF;
        const newAgg = this._getAgg();
        let bestIdx = 0;
        for (let i = 0; i < newAgg.length; i++) {
            if (newAgg[i].time <= currentTime) bestIdx = i;
            else break;
        }
        this.replayIndex = bestIdx;
        this._syncSubMode();
        this._renderFrame(true);
        if (wasPlaying) this.play();
    },

    _getAgg() {
        return aggregateCandles(this.baseData, this.currentTF);
    },

    togglePlay() { this.isPlaying ? this.pause() : this.play(); },

    play() {
        if (this.isPlaying) return;
        if (this._subMode) {
            if (this._baseIdx >= this.baseData.length - 1) this._baseIdx = 0;
        } else {
            const total = this._getAgg().length;
            if (this.replayIndex >= total - 1) this.replayIndex = 0;
        }
        this.isPlaying = true;
        this.dom.playBtn.textContent = '⏸';
        this.dom.playBtn.classList.add('playing');
        this._restartTimer();
    },

    pause() {
        this.isPlaying = false;
        this.dom.playBtn.textContent = '▶';
        this.dom.playBtn.classList.remove('playing');
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    stepForward() {
        if (this._subMode) {
            if (this._baseIdx < this.baseData.length - 1) {
                this._baseIdx++;
                this._renderFrame(false);
            }
        } else {
            const total = this._getAgg().length;
            if (this.replayIndex < total - 1) { this.replayIndex++; this._renderFrame(false); }
        }
    },

    stepBack() {
        if (this._subMode) {
            if (this._baseIdx > 0) { this._baseIdx--; this._renderFrame(false); }
        } else {
            if (this.replayIndex > 0) { this.replayIndex--; this._renderFrame(false); }
        }
    },

    goToStart() {
        this.pause();
        this.replayIndex = 0;
        this._baseIdx = 0;
        this._renderFrame(true);
    },

    goToEnd() {
        this.pause();
        this.replayIndex = this._getAgg().length - 1;
        this._baseIdx = this.baseData.length - 1;
        this._renderFrame(true);
    },

    _restartTimer() {
        if (this._timer) clearInterval(this._timer);
        let interval;
        if (this._subMode) {
            // Sub-candle mode: each tick = 1 base candle, interval scales with speed
            interval = Math.max(30, Math.round(400 / this.speed));
        } else {
            interval = Math.max(16, Math.round(500 / this.speed));
        }
        this._timer = setInterval(() => this._tick(), interval);
    },

    _tick() {
        if (this._subMode) {
            if (this._baseIdx >= this.baseData.length - 1) { this.pause(); return; }
            this._baseIdx++;
        } else {
            const total = this._getAgg().length;
            if (this.replayIndex >= total - 1) { this.pause(); return; }
            this.replayIndex++;
        }
        // During live play, DON'T force scroll — just append data
        this._renderFrame(false);
    },

    /**
     * @param {boolean} fitContent - If true, fit chart to content (on load/TF switch/jump).
     *   During normal playback, this is false so the user's scroll position is preserved.
     */
    _renderFrame(fitContent) {
        let visible;

        if (this._subMode) {
            // Sub-candle mode: aggregate only the base data up to _baseIdx
            const slice = this.baseData.slice(0, this._baseIdx + 1);
            visible = aggregateCandles(slice, this.currentTF);
            // Keep replayIndex in sync for progress bar and other systems
            this.replayIndex = visible.length - 1;
        } else {
            const allAgg = this._getAgg();
            const total = allAgg.length;
            if (total === 0) return;
            if (this.replayIndex >= total) this.replayIndex = total - 1;
            if (this.replayIndex < 0) this.replayIndex = 0;
            visible = allAgg.slice(0, this.replayIndex + 1);
        }

        if (!visible || visible.length === 0) return;

        // Save the real candle (with full OHLC) BEFORE flattening for open-only
        const realCandle = visible.length > 0 ? { ...visible[visible.length - 1] } : null;

        // Open-only mode: flatten the current (last) candle to just its open price
        if (this.openOnly && visible.length > 0) {
            const last = { ...visible[visible.length - 1] };
            last.high = last.open;
            last.low = last.open;
            last.close = last.open;
            visible[visible.length - 1] = last;
        }

        ChartManager.updateData(visible, this.indicatorState);

        // Only force-fit on explicit jumps (load, TF switch, go-to-start/end)
        if (fitContent) {
            ChartManager.mainChart.timeScale().fitContent();
        }

        // Use flattened candle for display price, but REAL candle for TP/SL checks
        const displayCandle = visible.length > 0 ? visible[visible.length - 1] : null;

        // Build the tick candle for the trading engine:
        // - high/low from the REAL candle → so TP/SL triggers on actual wicks
        // - close from the DISPLAY candle → so P&L and addon drawdown checks
        //   reflect the price the user actually sees (open in open-only mode)
        if (realCandle && TradingEngine.positions.length > 0) {
            const tickCandle = this.openOnly
                ? { ...realCandle, close: displayCandle.close }
                : realCandle;
            TradingEngine.onTick(tickCandle);
        }

        // Update position lines on chart
        ChartManager.updatePositionLines(TradingEngine.positions, displayCandle ? displayCandle.close : 0);

        // Emit candle to bridge (if connected)
        if (displayCandle && typeof BridgeClient !== 'undefined') BridgeClient.emitCandle(displayCandle);

        // Update UI controls
        const totalAgg = this._getAgg().length;
        const pct = totalAgg > 1 ? Math.round((this.replayIndex / (totalAgg - 1)) * 100) : 0;
        this.dom.progressBar.value = pct;
        if (this._subMode) {
            this.dom.barCounter.textContent = `${this.replayIndex + 1} / ${totalAgg} (base ${this._baseIdx + 1}/${this.baseData.length})`;
        } else {
            this.dom.barCounter.textContent = `${this.replayIndex + 1} / ${totalAgg}`;
        }
        if (displayCandle) {
            const dt = new Date(displayCandle.time * 1000);
            this.dom.datetime.textContent = dt.toISOString().replace('T', ' ').substring(0, 19);
        }
    },

    getCurrentPrice() {
        const allAgg = this._getAgg();
        const c = allAgg[this.replayIndex];
        if (!c) return 0;
        return this.openOnly ? c.open : c.close;
    },

    updateIndicators(state) {
        this.indicatorState = { ...state };
        this._renderFrame(false);
    },
};

/* ═══════════════ Replay Engine ═══════════════ */

const ReplayEngine = {
    baseData: [],
    currentTF: 60,
    replayIndex: 0,
    isPlaying: false,
    speed: 1,
    _timer: null,
    _userScrolled: false, // tracks if user has manually scrolled
    indicatorState: { sma: true, ema: false, bb: false, rsi: false, macd: false, vol: true },

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
            this.dom.speedLabel.textContent = this.speed + '×';
            if (this.isPlaying) this._restartTimer();
        });

        this.dom.progressBar.addEventListener('input', () => {
            const total = this._getAgg().length;
            this.replayIndex = Math.round((parseInt(this.dom.progressBar.value) / 100) * (total - 1));
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
                    this.speed = Math.min(20, this.speed + 0.5);
                    this.dom.speedSlider.value = this.speed;
                    this.dom.speedLabel.textContent = this.speed + '×';
                    if (this.isPlaying) this._restartTimer();
                    break;
                case 'Minus': case 'NumpadSubtract':
                    e.preventDefault();
                    this.speed = Math.max(0.5, this.speed - 0.5);
                    this.dom.speedSlider.value = this.speed;
                    this.dom.speedLabel.textContent = this.speed + '×';
                    if (this.isPlaying) this._restartTimer();
                    break;
                case 'Home': e.preventDefault(); this.goToStart(); break;
                case 'End': e.preventDefault(); this.goToEnd(); break;
            }
        });
    },

    loadData(data, tf) {
        this.pause();
        this.baseData = data;
        this.currentTF = tf || 60;
        this.replayIndex = 0;
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
        this._renderFrame(true);
        if (wasPlaying) this.play();
    },

    _getAgg() {
        return aggregateCandles(this.baseData, this.currentTF);
    },

    togglePlay() { this.isPlaying ? this.pause() : this.play(); },

    play() {
        if (this.isPlaying) return;
        const total = this._getAgg().length;
        if (this.replayIndex >= total - 1) this.replayIndex = 0;
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
        const total = this._getAgg().length;
        if (this.replayIndex < total - 1) { this.replayIndex++; this._renderFrame(false); }
    },

    stepBack() {
        if (this.replayIndex > 0) { this.replayIndex--; this._renderFrame(false); }
    },

    goToStart() { this.pause(); this.replayIndex = 0; this._renderFrame(true); },
    goToEnd() { this.pause(); this.replayIndex = this._getAgg().length - 1; this._renderFrame(true); },

    _restartTimer() {
        if (this._timer) clearInterval(this._timer);
        const interval = Math.max(16, Math.round(500 / this.speed));
        this._timer = setInterval(() => this._tick(), interval);
    },

    _tick() {
        const total = this._getAgg().length;
        if (this.replayIndex >= total - 1) { this.pause(); return; }
        this.replayIndex++;
        // During live play, DON'T force scroll — just append data
        this._renderFrame(false);
    },

    /**
     * @param {boolean} fitContent - If true, fit chart to content (on load/TF switch/jump).
     *   During normal playback, this is false so the user's scroll position is preserved.
     */
    _renderFrame(fitContent) {
        const allAgg = this._getAgg();
        const total = allAgg.length;
        if (total === 0) return;
        if (this.replayIndex >= total) this.replayIndex = total - 1;
        if (this.replayIndex < 0) this.replayIndex = 0;

        const visible = allAgg.slice(0, this.replayIndex + 1);
        ChartManager.updateData(visible, this.indicatorState);

        // Only force-fit on explicit jumps (load, TF switch, go-to-start/end)
        if (fitContent) {
            ChartManager.mainChart.timeScale().fitContent();
        }

        // Trading engine: check TP/SL on latest candle
        const currentCandle = allAgg[this.replayIndex];
        if (currentCandle && TradingEngine.positions.length > 0) {
            TradingEngine.onTick(currentCandle);
        }

        // Update position lines on chart
        ChartManager.updatePositionLines(TradingEngine.positions, currentCandle ? currentCandle.close : 0);

        // Emit candle to bridge (if connected)
        if (currentCandle && typeof BridgeClient !== 'undefined') BridgeClient.emitCandle(currentCandle);

        // Update UI controls
        const pct = total > 1 ? Math.round((this.replayIndex / (total - 1)) * 100) : 0;
        this.dom.progressBar.value = pct;
        this.dom.barCounter.textContent = `${this.replayIndex + 1} / ${total}`;
        if (currentCandle) {
            const dt = new Date(currentCandle.time * 1000);
            this.dom.datetime.textContent = dt.toISOString().replace('T', ' ').substring(0, 19);
        }
    },

    getCurrentPrice() {
        const allAgg = this._getAgg();
        const c = allAgg[this.replayIndex];
        return c ? c.close : 0;
    },

    updateIndicators(state) {
        this.indicatorState = { ...state };
        this._renderFrame(false);
    },
};

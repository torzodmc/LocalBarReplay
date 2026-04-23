/* ═══════════════ Chart Manager — Lightweight Charts v5 ═══════════════ */

const ChartManager = {
    mainChart: null, rsiChart: null, macdChart: null, volChart: null,
    candleSeries: null,
    sma1Series: null, sma2Series: null,
    ema1Series: null, ema2Series: null,
    bbUpperSeries: null, bbMiddleSeries: null, bbLowerSeries: null,
    rsiSeries: null,
    macdLineSeries: null, macdSignalSeries: null, macdHistSeries: null,
    volSeries: null,

    // Custom PineScript series
    customSeries: [],

    // Position lines (entry/TP/SL price lines)
    _positionLines: [],

    // Click-to-pick TP/SL mode
    _pickMode: null, // null | 'tp' | 'sl'

    _resizeHandler: null,
    _lastCandles: null,

    params: {
        sma1: 20, sma2: 50, sma1On: true, sma2On: true,
        ema1: 12, ema2: 26, ema1On: true, ema2On: true,
        bbPeriod: 20, bbMult: 2,
        rsiPeriod: 14,
        macdFast: 12, macdSlow: 26, macdSignal: 9,
    },

    chartOptions(el) {
        return {
            width: el.clientWidth, height: el.clientHeight,
            layout: { background: { type: 'solid', color: '#131722' }, textColor: '#787b86', fontFamily: "'Inter', sans-serif", fontSize: 11 },
            grid: { vertLines: { color: 'rgba(42,46,57,0.5)' }, horzLines: { color: 'rgba(42,46,57,0.5)' } },
            crosshair: {
                mode: 0,
                vertLine: { color: 'rgba(41,98,255,0.4)', width: 1, style: 2, labelBackgroundColor: '#2962ff' },
                horzLine: { color: 'rgba(41,98,255,0.4)', width: 1, style: 2, labelBackgroundColor: '#2962ff' },
            },
            rightPriceScale: { borderColor: '#363a45', scaleMargins: { top: 0.1, bottom: 0.1 } },
            timeScale: { borderColor: '#363a45', timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 6 },
            handleScroll: { vertTouchDrag: false },
        };
    },

    subOpts(el) {
        const o = this.chartOptions(el);
        o.rightPriceScale.scaleMargins = { top: 0.15, bottom: 0.05 };
        o.timeScale.visible = false;
        return o;
    },

    init() {
        const mainEl = document.getElementById('chart-main');
        const volEl = document.getElementById('chart-vol');
        this.mainChart = LightweightCharts.createChart(mainEl, this.chartOptions(mainEl));
        this.volChart = LightweightCharts.createChart(volEl, this.subOpts(volEl));

        this.candleSeries = this.mainChart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#26a69a', downColor: '#ef5350',
            borderUpColor: '#26a69a', borderDownColor: '#ef5350',
            wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        });

        const lo = (color) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        this.sma1Series = this.mainChart.addSeries(LightweightCharts.LineSeries, lo('#f7a21b'));
        this.sma2Series = this.mainChart.addSeries(LightweightCharts.LineSeries, lo('#42bda8'));
        this.ema1Series = this.mainChart.addSeries(LightweightCharts.LineSeries, lo('#e91e63'));
        this.ema2Series = this.mainChart.addSeries(LightweightCharts.LineSeries, lo('#9c27b0'));
        this.bbUpperSeries = this.mainChart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(33,150,243,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
        this.bbMiddleSeries = this.mainChart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(33,150,243,0.6)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        this.bbLowerSeries = this.mainChart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(33,150,243,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
        this.volSeries = this.volChart.addSeries(LightweightCharts.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } });

        // Sync time scales
        this.mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (range) {
                this.volChart.timeScale().setVisibleLogicalRange(range);
                if (this.rsiChart) this.rsiChart.timeScale().setVisibleLogicalRange(range);
                if (this.macdChart) this.macdChart.timeScale().setVisibleLogicalRange(range);
            }
        });

        // ── Click-to-pick TP/SL: chart click handler ──
        const chartEl = document.getElementById('chart-main');
        chartEl.addEventListener('click', (e) => {
            if (!this._pickMode) return;
            const rect = chartEl.getBoundingClientRect();
            const y = e.clientY - rect.top;
            let price;
            try { price = this.candleSeries.coordinateToPrice(y); } catch (err) { return; }
            if (price === null || price <= 0) return;

            const field = this._pickMode; // 'tp' or 'sl'
            const input = document.getElementById('trade-' + field);
            if (input) {
                const prec = price > 10 ? 2 : 5;
                input.value = price.toFixed(prec);
            }

            // Exit pick mode
            this.exitPickMode();
        });

        this._resizeHandler = () => this.resize();
        window.addEventListener('resize', this._resizeHandler);
        setTimeout(() => this.resize(), 50);
    },

    // ── Pick mode management ──
    enterPickMode(field) {
        // field = 'tp' or 'sl'
        this._pickMode = field;
        const chartEl = document.getElementById('chart-main');
        chartEl.style.cursor = 'crosshair';
        chartEl.classList.add('pick-active');
        // Highlight the active pick button
        const btn = document.getElementById('btn-pick-' + field);
        if (btn) btn.classList.add('picking');
    },

    exitPickMode() {
        this._pickMode = null;
        const chartEl = document.getElementById('chart-main');
        chartEl.style.cursor = '';
        chartEl.classList.remove('pick-active');
        document.querySelectorAll('.pick-btn.picking').forEach(b => b.classList.remove('picking'));
    },

    // ═══════ Position Lines (entry + TP/SL price lines) ═══════

    _clearPositionLines() {
        for (const pl of this._positionLines) {
            try { if (pl.entryLine) this.candleSeries.removePriceLine(pl.entryLine); } catch (e) { }
            try { if (pl.tpLine) this.candleSeries.removePriceLine(pl.tpLine); } catch (e) { }
            try { if (pl.slLine) this.candleSeries.removePriceLine(pl.slLine); } catch (e) { }
        }
        this._positionLines = [];
    },

    updatePositionLines(positions, currentPrice) {
        this._clearPositionLines();
        if (!positions.length) return;
        const prec = currentPrice > 10 ? 2 : 5;

        for (const pos of positions) {
            const isBuy = pos.side === 'buy';
            const pl = { posId: pos.id };

            // Entry line (solid)
            pl.entryLine = this.candleSeries.createPriceLine({
                price: pos.entryPrice,
                color: isBuy ? '#26a69a' : '#ef5350',
                lineWidth: 1.5, lineStyle: 0, axisLabelVisible: true,
                title: `${pos.side.toUpperCase()} ${pos.lots.toFixed(3)}L @${pos.entryPrice.toFixed(prec)}`,
            });

            // TP line
            if (pos.tp) {
                pl.tpLine = this.candleSeries.createPriceLine({
                    price: pos.tp, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
                    title: `TP ${pos.tp.toFixed(prec)}`,
                });
            }

            // SL line
            if (pos.sl) {
                pl.slLine = this.candleSeries.createPriceLine({
                    price: pos.sl, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
                    title: `SL ${pos.sl.toFixed(prec)}`,
                });
            }

            this._positionLines.push(pl);
        }
    },

    // ═══════ Custom PineScript series ═══════

    clearCustomSeries() {
        for (const s of this.customSeries) {
            try { this.mainChart.removeSeries(s); } catch (e) { }
        }
        this.customSeries = [];
    },

    addCustomLineSeries(data, color, title) {
        const s = this.mainChart.addSeries(LightweightCharts.LineSeries, {
            color: color || '#ff9800', lineWidth: 1.5,
            priceLineVisible: false, lastValueVisible: true, title: title || '',
        });
        s.setData(data.filter(d => !isNaN(d.value)));
        this.customSeries.push(s);
        return s;
    },

    // ═══════ Sub-charts ═══════

    ensureRSIChart() {
        if (this.rsiChart) return;
        const el = document.getElementById('chart-rsi');
        el.classList.remove('hidden');
        this.rsiChart = LightweightCharts.createChart(el, this.subOpts(el));
        this.rsiSeries = this.rsiChart.addSeries(LightweightCharts.LineSeries, { color: '#ab47bc', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        this.rsiSeries.createPriceLine({ price: 70, color: 'rgba(239,83,80,0.3)', lineWidth: 1, lineStyle: 2 });
        this.rsiSeries.createPriceLine({ price: 30, color: 'rgba(38,166,154,0.3)', lineWidth: 1, lineStyle: 2 });
        this.resize();
    },

    ensureMACDChart() {
        if (this.macdChart) return;
        const el = document.getElementById('chart-macd');
        el.classList.remove('hidden');
        this.macdChart = LightweightCharts.createChart(el, this.subOpts(el));
        this.macdLineSeries = this.macdChart.addSeries(LightweightCharts.LineSeries, { color: '#2196f3', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        this.macdSignalSeries = this.macdChart.addSeries(LightweightCharts.LineSeries, { color: '#ff9800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        this.macdHistSeries = this.macdChart.addSeries(LightweightCharts.HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
        this.macdLineSeries.createPriceLine({ price: 0, color: 'rgba(120,123,134,0.3)', lineWidth: 1, lineStyle: 2 });
        this.resize();
    },

    destroyRSIChart() { if (!this.rsiChart) return; this.rsiChart.remove(); this.rsiChart = null; this.rsiSeries = null; document.getElementById('chart-rsi').classList.add('hidden'); this.resize(); },
    destroyMACDChart() { if (!this.macdChart) return; this.macdChart.remove(); this.macdChart = null; this.macdLineSeries = null; this.macdSignalSeries = null; this.macdHistSeries = null; document.getElementById('chart-macd').classList.add('hidden'); this.resize(); },

    resize() {
        for (const [chart, id] of [[this.mainChart, 'chart-main'], [this.volChart, 'chart-vol'], [this.rsiChart, 'chart-rsi'], [this.macdChart, 'chart-macd']]) {
            if (!chart) continue;
            const el = document.getElementById(id);
            chart.resize(el.clientWidth, el.clientHeight);
        }
    },

    clearAll() {
        for (const s of [this.candleSeries, this.sma1Series, this.sma2Series, this.ema1Series, this.ema2Series, this.bbUpperSeries, this.bbMiddleSeries, this.bbLowerSeries, this.volSeries]) {
            if (s) s.setData([]);
        }
        if (this.rsiSeries) this.rsiSeries.setData([]);
        if (this.macdLineSeries) this.macdLineSeries.setData([]);
        if (this.macdSignalSeries) this.macdSignalSeries.setData([]);
        if (this.macdHistSeries) this.macdHistSeries.setData([]);
        this._clearPositionLines();
        this.clearCustomSeries();
    },

    _f(arr) { return arr.filter(d => !isNaN(d.value)); },

    updateData(candles, indState) {
        if (!candles || candles.length === 0) return;
        this._lastCandles = candles;
        const p = this.params;
        this.candleSeries.setData(candles);

        if (indState.vol) { this.volSeries.setData(Indicators.volume(candles)); } else { this.volSeries.setData([]); }
        if (indState.sma && p.sma1On) { this.sma1Series.setData(this._f(Indicators.sma(candles, p.sma1))); } else { this.sma1Series.setData([]); }
        if (indState.sma && p.sma2On) { this.sma2Series.setData(this._f(Indicators.sma(candles, p.sma2))); } else { this.sma2Series.setData([]); }
        if (indState.ema && p.ema1On) { this.ema1Series.setData(this._f(Indicators.ema(candles, p.ema1))); } else { this.ema1Series.setData([]); }
        if (indState.ema && p.ema2On) { this.ema2Series.setData(this._f(Indicators.ema(candles, p.ema2))); } else { this.ema2Series.setData([]); }
        if (indState.bb) { const bb = Indicators.bollingerBands(candles, p.bbPeriod, p.bbMult); this.bbUpperSeries.setData(this._f(bb.upper)); this.bbMiddleSeries.setData(this._f(bb.middle)); this.bbLowerSeries.setData(this._f(bb.lower)); }
        else { this.bbUpperSeries.setData([]); this.bbMiddleSeries.setData([]); this.bbLowerSeries.setData([]); }
        if (indState.rsi) { this.ensureRSIChart(); this.rsiSeries.setData(this._f(Indicators.rsi(candles, p.rsiPeriod))); }
        else { this.destroyRSIChart(); }
        if (indState.macd) { this.ensureMACDChart(); const m = Indicators.macd(candles, p.macdFast, p.macdSlow, p.macdSignal); this.macdLineSeries.setData(this._f(m.macdLine)); this.macdSignalSeries.setData(this._f(m.signalLine)); this.macdHistSeries.setData(m.histogram); }
        else { this.destroyMACDChart(); }

        // Custom PineScript indicators
        if (typeof PineEngine !== 'undefined') PineEngine.renderAll(candles);
    },

    /** Get current EMA values at latest visible candle */
    getEMASnapshot(candles) {
        if (!candles || candles.length === 0) return { ema1: null, ema2: null };
        const p = this.params;
        const ema1Data = Indicators.ema(candles, p.ema1);
        const ema2Data = Indicators.ema(candles, p.ema2);
        const last1 = ema1Data[ema1Data.length - 1];
        const last2 = ema2Data[ema2Data.length - 1];
        return {
            ema1: last1 && !isNaN(last1.value) ? last1.value : null,
            ema2: last2 && !isNaN(last2.value) ? last2.value : null,
            ema1Period: p.ema1,
            ema2Period: p.ema2,
        };
    },
};

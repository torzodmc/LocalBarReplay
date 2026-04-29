/**
 * LocalBarReplay Trade Context Addon — Full Market Snapshot
 *
 * This addon records a comprehensive market snapshot at every trade
 * open and close. Designed to capture enough data to reverse-engineer
 * discretionary trading decisions — useful for feeding into AI models
 * or statistical analysis.
 *
 * Recorded at open AND close:
 *   - EMA(4): value, distance from price, distance %, slope, candles since touch
 *   - All active EMAs/SMAs, RSI, MACD, Bollinger Bands
 *   - ATR(14), trend direction, 50-candle range, price percentile
 *   - Candle geometry (body ratio, wick ratio, gap from prev close)
 *   - Volume ratio vs 20-candle avg
 *   - Datetime, day of week, hour, timeframe, replay state
 *
 * To enable: add to index.html (after tradeaddons.js):
 *   <script src="addons/full_trade_context.js"></script>
 */

LocalBarReplay.registerTradeAddon({
    name: 'Full Trade Context',
    version: '1.0',

    _capture(ctx) {
        const candles = ctx.history;
        const n = candles.length;
        if (n === 0) return {};
        const cur = candles[n - 1];
        const prev = n >= 2 ? candles[n - 2] : cur;
        const price = ctx.price;
        const p = ChartManager.params;

        // ── Candle geometry ──
        const bodySize = Math.abs(cur.close - cur.open);
        const range = cur.high - cur.low;
        const candleBodyRatio = range > 0 ? +(bodySize / range).toFixed(4) : 0;
        const upperWick = cur.high - Math.max(cur.open, cur.close);
        const lowerWick = Math.min(cur.open, cur.close) - cur.low;
        const wickRatio = lowerWick > 0 ? +(upperWick / lowerWick).toFixed(4) : 0;
        const gapFromPrevClose = +(cur.open - prev.close).toFixed(8);

        // ── 50-candle range ──
        const lb50 = candles.slice(-50);
        const high50 = Math.max(...lb50.map(c => c.high));
        const low50 = Math.min(...lb50.map(c => c.low));
        const span50 = high50 - low50;
        const priceInRange50 = span50 > 0 ? +((price - low50) / span50 * 100).toFixed(2) : 50;

        // ── Volume ──
        const vols20 = candles.slice(-20).map(c => c.volume);
        const avgVol = vols20.reduce((a, b) => a + b, 0) / vols20.length;
        const volumeRatio = avgVol > 0 ? +(cur.volume / avgVol).toFixed(3) : 1;

        // ── EMA(4) — primary strategy indicator ──
        const ema4Data = Indicators.ema(candles, 4);
        const ema4 = Indicators.lastValue(ema4Data);
        const ema4_3ago = n >= 4 ? Indicators.valueAt(ema4Data, n - 4) : null;
        const ema4Distance = ema4 !== null ? +(price - ema4).toFixed(8) : null;
        const ema4DistPct = ema4 !== null && ema4 > 0 ? +((price - ema4) / ema4 * 100).toFixed(4) : null;
        const ema4Slope = (ema4 !== null && ema4_3ago !== null) ? +(ema4 - ema4_3ago).toFixed(8) : null;

        // Candles since EMA(4) touch
        let ema4TouchCandles = null;
        for (let i = n - 2; i >= 0; i--) {
            const v = ema4Data[i]?.value;
            if (v !== undefined && !isNaN(v)) {
                if (candles[i].low <= v && candles[i].high >= v) { ema4TouchCandles = (n - 1) - i; break; }
            }
        }

        // ── Active indicator snapshots ──
        const ema1v = Indicators.lastValue(Indicators.ema(candles, p.ema1));
        const ema2v = Indicators.lastValue(Indicators.ema(candles, p.ema2));
        const sma1v = Indicators.lastValue(Indicators.sma(candles, p.sma1));
        const sma2v = Indicators.lastValue(Indicators.sma(candles, p.sma2));
        const rsiV = Indicators.lastValue(Indicators.rsi(candles, p.rsiPeriod));

        const macdR = Indicators.macd(candles, p.macdFast, p.macdSlow, p.macdSignal);
        const macdLine = Indicators.lastValue(macdR.macdLine);
        const macdSig = Indicators.lastValue(macdR.signalLine);
        const macdHist = macdR.histogram.length > 0 ? macdR.histogram[macdR.histogram.length - 1].value : null;

        const bb = Indicators.bollingerBands(candles, p.bbPeriod, p.bbMult);
        const bbU = Indicators.lastValue(bb.upper);
        const bbM = Indicators.lastValue(bb.middle);
        const bbL = Indicators.lastValue(bb.lower);
        const bbW = (bbU !== null && bbL !== null) ? +(bbU - bbL).toFixed(8) : null;
        const bbPos = (bbW && bbW > 0) ? +((price - bbL) / bbW * 100).toFixed(2) : null;

        // ── ATR ──
        const atr14 = Indicators.lastValue(Indicators.atr(candles, 14));

        // ── Trend (SMA20 slope) ──
        const sma20D = Indicators.sma(candles, 20);
        const sma20Now = Indicators.lastValue(sma20D);
        const sma20_10ago = n >= 11 ? Indicators.valueAt(sma20D, n - 11) : null;
        const trendDirection = (sma20Now !== null && sma20_10ago !== null)
            ? (sma20Now > sma20_10ago ? 'up' : sma20Now < sma20_10ago ? 'down' : 'sideways')
            : 'unknown';

        // ── Time ──
        const dt = new Date(cur.time * 1000);

        return {
            datetime: dt.toISOString().replace('T', ' ').substring(0, 19),
            dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()],
            hourOfDay: dt.getUTCHours(),
            timeframe: ReplayEngine.currentTF + 'm',
            price: +price.toFixed(8),
            // Candle
            candleOpen: cur.open, candleHigh: cur.high, candleLow: cur.low, candleClose: cur.close,
            candleBodyRatio, wickRatio, gapFromPrevClose,
            // Range
            priceInRange50,
            recentHigh50: +high50.toFixed(8),
            recentLow50: +low50.toFixed(8),
            volumeRatio,
            // EMA(4)
            ema4: ema4 !== null ? +ema4.toFixed(8) : null,
            ema4Distance, ema4DistancePct: ema4DistPct,
            ema4Slope, ema4TouchCandles,
            // Active indicators
            [`ema${p.ema1}`]: ema1v !== null ? +ema1v.toFixed(8) : null,
            [`ema${p.ema2}`]: ema2v !== null ? +ema2v.toFixed(8) : null,
            [`sma${p.sma1}`]: sma1v !== null ? +sma1v.toFixed(8) : null,
            [`sma${p.sma2}`]: sma2v !== null ? +sma2v.toFixed(8) : null,
            rsi: rsiV !== null ? +rsiV.toFixed(2) : null,
            macdLine, macdSignal: macdSig, macdHistogram: macdHist,
            bbUpper: bbU, bbMiddle: bbM, bbLower: bbL, bbWidth: bbW, bbPosition: bbPos,
            atr14: atr14 !== null ? +atr14.toFixed(8) : null,
            trendDirection,
        };
    },

    onTradeOpen(ctx) {
        return this._capture(ctx);
    },

    onTradeClose(ctx, openData) {
        return this._capture(ctx);
    },
});

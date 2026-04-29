/* ═══════════════ Technical Indicators ═══════════════ */

const Indicators = {
    /**
     * Simple Moving Average
     * @param {Array} data - candle array with .close
     * @param {number} period
     * @returns {Array<{time, value}>}
     */
    sma(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push({ time: data[i].time, value: NaN });
                continue;
            }
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
            result.push({ time: data[i].time, value: sum / period });
        }
        return result;
    },

    /**
     * Exponential Moving Average
     */
    ema(data, period) {
        const result = [];
        const k = 2 / (period + 1);
        let prev = null;
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push({ time: data[i].time, value: NaN });
                continue;
            }
            if (prev === null) {
                // Seed with SMA
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
                prev = sum / period;
            } else {
                prev = data[i].close * k + prev * (1 - k);
            }
            result.push({ time: data[i].time, value: prev });
        }
        return result;
    },

    /**
     * Bollinger Bands (middle = SMA, upper/lower = +/- stddev * mult)
     */
    bollingerBands(data, period = 20, mult = 2) {
        const smaVals = this.sma(data, period);
        const upper = [], lower = [], middle = [];
        for (let i = 0; i < data.length; i++) {
            middle.push({ time: data[i].time, value: smaVals[i].value });
            if (i < period - 1) {
                upper.push({ time: data[i].time, value: NaN });
                lower.push({ time: data[i].time, value: NaN });
                continue;
            }
            let sumSq = 0;
            for (let j = i - period + 1; j <= i; j++) {
                const diff = data[j].close - smaVals[i].value;
                sumSq += diff * diff;
            }
            const std = Math.sqrt(sumSq / period);
            upper.push({ time: data[i].time, value: smaVals[i].value + std * mult });
            lower.push({ time: data[i].time, value: smaVals[i].value - std * mult });
        }
        return { upper, middle, lower };
    },

    /**
     * RSI (Relative Strength Index)
     */
    rsi(data, period = 14) {
        const result = [];
        if (data.length < period + 1) {
            return data.map(d => ({ time: d.time, value: NaN }));
        }

        let avgGain = 0, avgLoss = 0;
        // First average
        for (let i = 1; i <= period; i++) {
            const change = data[i].close - data[i - 1].close;
            if (change > 0) avgGain += change;
            else avgLoss += Math.abs(change);
            result.push({ time: data[i - 1].time, value: NaN });
        }
        avgGain /= period;
        avgLoss /= period;

        // Seed RSI
        const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push({ time: data[period].time, value: 100 - 100 / (1 + rs0) });

        // Subsequent
        for (let i = period + 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            result.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
        }
        return result;
    },

    /**
     * MACD (Moving Average Convergence Divergence)
     * Returns { macdLine[], signalLine[], histogram[] }
     */
    macd(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const emaFast = this.ema(data, fastPeriod);
        const emaSlow = this.ema(data, slowPeriod);

        // MACD line = EMA fast - EMA slow
        const macdLine = [];
        for (let i = 0; i < data.length; i++) {
            const val = (isNaN(emaFast[i].value) || isNaN(emaSlow[i].value))
                ? NaN
                : emaFast[i].value - emaSlow[i].value;
            macdLine.push({ time: data[i].time, value: val });
        }

        // Signal line = EMA of MACD line
        const validMacd = macdLine.filter(m => !isNaN(m.value));
        const signalLine = [];
        const k = 2 / (signalPeriod + 1);
        let prev = null;
        let validIdx = 0;

        for (let i = 0; i < macdLine.length; i++) {
            if (isNaN(macdLine[i].value)) {
                signalLine.push({ time: data[i].time, value: NaN });
                continue;
            }
            validIdx++;
            if (validIdx < signalPeriod) {
                signalLine.push({ time: data[i].time, value: NaN });
                continue;
            }
            if (prev === null) {
                let sum = 0;
                const start = macdLine.findIndex(m => !isNaN(m.value));
                for (let j = start; j < start + signalPeriod; j++) sum += macdLine[j].value;
                prev = sum / signalPeriod;
            } else {
                prev = macdLine[i].value * k + prev * (1 - k);
            }
            signalLine.push({ time: data[i].time, value: prev });
        }

        // Histogram = MACD - Signal
        const histogram = [];
        for (let i = 0; i < data.length; i++) {
            const val = (isNaN(macdLine[i].value) || isNaN(signalLine[i].value))
                ? NaN
                : macdLine[i].value - signalLine[i].value;
            histogram.push({
                time: data[i].time,
                value: isNaN(val) ? 0 : val,
                color: isNaN(val) ? 'transparent' : (val >= 0 ? '#26a69a' : '#ef5350'),
            });
        }

        return { macdLine, signalLine, histogram };
    },

    /**
     * Volume colored by candle direction.
     */
    volume(data) {
        return data.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        }));
    },

    /**
     * Average True Range
     */
    atr(data, period = 14) {
        const result = [];
        if (data.length < 2) return data.map(d => ({ time: d.time, value: NaN }));
        const trs = [{ time: data[0].time, value: data[0].high - data[0].low }];
        for (let i = 1; i < data.length; i++) {
            const tr = Math.max(
                data[i].high - data[i].low,
                Math.abs(data[i].high - data[i - 1].close),
                Math.abs(data[i].low - data[i - 1].close)
            );
            trs.push({ time: data[i].time, value: tr });
        }
        // RMA (Wilder's smoothing)
        let avg = 0;
        for (let i = 0; i < data.length; i++) {
            if (i < period) {
                avg += trs[i].value;
                if (i === period - 1) { avg /= period; result.push({ time: data[i].time, value: avg }); }
                else result.push({ time: data[i].time, value: NaN });
            } else {
                avg = (avg * (period - 1) + trs[i].value) / period;
                result.push({ time: data[i].time, value: avg });
            }
        }
        return result;
    },

    /** Get the last valid (non-NaN) value from an indicator result array */
    lastValue(arr) {
        if (!arr || arr.length === 0) return null;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] && !isNaN(arr[i].value)) return arr[i].value;
        }
        return null;
    },

    /** Get value at a specific index */
    valueAt(arr, idx) {
        if (!arr || idx < 0 || idx >= arr.length) return null;
        const v = arr[idx].value;
        return isNaN(v) ? null : v;
    },
};

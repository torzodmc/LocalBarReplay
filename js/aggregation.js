/* ═══════════════ Timeframe Aggregation Engine ═══════════════ */

/**
 * Aggregate base-resolution candles (e.g. 5m) into a target timeframe.
 * Groups by period boundaries (e.g. 1h bars start at :00).
 * 
 * @param {Array} baseData - Array of {time, open, high, low, close, volume}
 * @param {number} targetMinutes - Target timeframe in minutes (15, 30, 60, 240, etc.)
 * @returns {Array} Aggregated candles
 */
function aggregateCandles(baseData, targetMinutes) {
    if (!baseData || baseData.length === 0) return [];
    if (targetMinutes <= 5) {
        // Base resolution or lower — return as-is
        return baseData.map(d => ({ ...d }));
    }

    const periodSecs = targetMinutes * 60;
    const result = [];
    let current = null;

    for (const bar of baseData) {
        // Compute the period boundary this bar belongs to
        const periodStart = Math.floor(bar.time / periodSecs) * periodSecs;

        if (!current || current.time !== periodStart) {
            // Flush previous candle
            if (current) result.push(current);
            current = {
                time: periodStart,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            };
        } else {
            // Merge into current candle
            current.high = Math.max(current.high, bar.high);
            current.low = Math.min(current.low, bar.low);
            current.close = bar.close;
            current.volume += bar.volume;
        }
    }
    if (current) result.push(current);

    return result;
}

/**
 * Aggregate only up to a given base index (for replay).
 * Returns the aggregated candles up to and including the bar
 * containing baseData[upToIndex].
 */
function aggregateUpTo(baseData, targetMinutes, upToIndex) {
    const slice = baseData.slice(0, upToIndex + 1);
    return aggregateCandles(slice, targetMinutes);
}

/**
 * Given a target-timeframe candle index, find the corresponding
 * last base-data index that falls within that aggregated candle.
 */
function aggregatedIndexToBaseIndex(baseData, targetMinutes, aggIndex) {
    if (targetMinutes <= 5) return aggIndex;
    const aggCandles = aggregateCandles(baseData, targetMinutes);
    if (aggIndex >= aggCandles.length) return baseData.length - 1;
    const targetTime = aggCandles[aggIndex].time;
    const periodSecs = targetMinutes * 60;
    const periodEnd = targetTime + periodSecs;
    // Find last base bar in this period
    let lastIdx = 0;
    for (let i = 0; i < baseData.length; i++) {
        if (baseData[i].time >= targetTime && baseData[i].time < periodEnd) {
            lastIdx = i;
        }
        if (baseData[i].time >= periodEnd) break;
    }
    return lastIdx;
}

/**
 * Given a base data index, find the corresponding aggregated candle index.
 */
function baseIndexToAggregatedIndex(baseData, targetMinutes, baseIdx) {
    if (targetMinutes <= 5) return baseIdx;
    const periodSecs = targetMinutes * 60;
    const barTime = baseData[baseIdx].time;
    const periodStart = Math.floor(barTime / periodSecs) * periodSecs;

    // Count unique periods up to this point
    const seen = new Set();
    for (let i = 0; i <= baseIdx; i++) {
        const ps = Math.floor(baseData[i].time / periodSecs) * periodSecs;
        seen.add(ps);
    }
    return seen.size - 1;
}

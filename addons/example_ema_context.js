/**
 * LocalBarReplay Trade Context Addon — EMA Strategy Context
 *
 * Records detailed EMA(4) context for strategies that rely on price
 * distance from a fast EMA to time entries. Designed to help identify
 * the exact visual conditions under which trades are placed, so the
 * data can be fed into an AI or statistical model.
 *
 * To use: add this line anywhere in index.html after tradeaddons.js:
 *   <script src="addons/example_ema_context.js"></script>
 */

LocalBarReplay.registerTradeAddon({
    name: 'EMA Strategy Context',
    version: '1.0',

    onTradeOpen(ctx) {
        const ema4 = ctx.ema(4);
        const ema9 = ctx.ema(9);
        const ema21 = ctx.ema(21);
        const ema50 = ctx.ema(50);

        const dist4 = ema4 !== null ? ctx.price - ema4 : null;
        const dist9 = ema9 !== null ? ctx.price - ema9 : null;
        const dist21 = ema21 !== null ? ctx.price - ema21 : null;
        const dist50 = ema50 !== null ? ctx.price - ema50 : null;

        return {
            // EMA distances from price
            ema4_value: ema4,
            ema4_distance: dist4 !== null ? +dist4.toFixed(8) : null,
            ema4_distance_pct: (dist4 !== null && ema4 > 0) ? +(dist4 / ema4 * 100).toFixed(4) : null,
            ema4_slope_3c: ctx.slope((d, p) => Indicators.ema(d, p), 4, 3),
            ema4_candles_since_touch: ctx.candlesSinceEMATouch(4),

            ema9_value: ema9,
            ema9_distance: dist9 !== null ? +dist9.toFixed(8) : null,
            ema21_value: ema21,
            ema21_distance: dist21 !== null ? +dist21.toFixed(8) : null,
            ema50_value: ema50,
            ema50_distance: dist50 !== null ? +dist50.toFixed(8) : null,

            // Are EMAs stacked? (bullish alignment)
            ema_stacked_bullish: (ema4 !== null && ema9 !== null && ema21 !== null)
                ? (ema4 > ema9 && ema9 > ema21) : null,
            ema_stacked_bearish: (ema4 !== null && ema9 !== null && ema21 !== null)
                ? (ema4 < ema9 && ema9 < ema21) : null,

            // Price context
            price_in_range_50: ctx.priceInRange(50),
            atr14: ctx.atr(14),
            rsi14: ctx.rsi(14),
        };
    },

    onTradeClose(ctx, openData) {
        const ema4 = ctx.ema(4);
        const dist4 = ema4 !== null ? ctx.price - ema4 : null;
        return {
            ema4_at_exit: ema4,
            ema4_distance_at_exit: dist4 !== null ? +dist4.toFixed(8) : null,
            ema4_distance_pct_at_exit: (dist4 !== null && ema4 > 0) ? +(dist4 / ema4 * 100).toFixed(4) : null,
            rsi14_at_exit: ctx.rsi(14),
            price_in_range_at_exit: ctx.priceInRange(50),
            // Compare to entry
            ema4_distance_change: (dist4 !== null && openData?.ema4_distance !== null)
                ? +(dist4 - openData.ema4_distance).toFixed(8) : null,
        };
    },
});

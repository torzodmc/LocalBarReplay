/* ═══════════════ Trade Context Addon System ═══════════════
 *
 * HIDDEN FEATURE — For developers only.
 * Normal users will never see this unless they open the source code.
 *
 * How to use:
 *   1. Create a .js file that calls LocalBarReplay.registerTradeAddon({ ... })
 *   2. Add a <script src="addons/your_addon.js"></script> to index.html
 *   3. The addon's onTradeOpen / onTradeClose hooks fire automatically
 *
 * ═══════════════════════════════════════════════════════ */

const TradeAddonManager = {
    _addons: [],

    /** Register a new addon. Called by addon files. */
    register(config) {
        if (!config || !config.name) { console.warn('[TradeAddonManager] Addon must have a name.'); return; }
        console.log(`[TradeAddonManager] Addon loaded: "${config.name}"`);
        this._addons.push(config);
    },

    /** Build the context (ctx) object passed to addon hooks. */
    _buildCtx(candles, price, builtinContext) {
        return {
            price,
            candle: candles[candles.length - 1],
            history: candles,
            builtinIndicators: builtinContext || {},
            prevCandles(n) { return candles.slice(-n - 1, -1); },
            priceInRange(lookback) {
                const slice = candles.slice(-lookback);
                const hi = Math.max(...slice.map(c => c.high));
                const lo = Math.min(...slice.map(c => c.low));
                return hi > lo ? ((price - lo) / (hi - lo)) * 100 : 50;
            },
            atr(period) {
                const data = Indicators.atr(candles, period);
                return Indicators.lastValue(data);
            },
            ema(period) {
                const data = Indicators.ema(candles, period);
                return Indicators.lastValue(data);
            },
            sma(period) {
                const data = Indicators.sma(candles, period);
                return Indicators.lastValue(data);
            },
            rsi(period) {
                const data = Indicators.rsi(candles, period || 14);
                return Indicators.lastValue(data);
            },
            // Slope of an indicator over N candles back
            slope(indicatorFn, period, lookback) {
                const data = indicatorFn(candles, period);
                const n = data.length;
                const now = Indicators.lastValue(data);
                const ago = n >= lookback + 1 ? Indicators.valueAt(data, n - 1 - lookback) : null;
                return (now !== null && ago !== null) ? now - ago : null;
            },
            // How many candles since price last touched an EMA
            candlesSinceEMATouch(period) {
                const data = Indicators.ema(candles, period);
                const n = candles.length;
                for (let i = n - 2; i >= 0; i--) {
                    const v = data[i] ? data[i].value : NaN;
                    if (!isNaN(v) && candles[i].low <= v && candles[i].high >= v) {
                        return (n - 1) - i;
                    }
                }
                return null;
            },
        };
    },

    /** Called when a trade is opened. Returns merged addon custom fields. */
    onOpen(candles, price, builtinContext) {
        if (this._addons.length === 0) return {};
        const ctx = this._buildCtx(candles, price, builtinContext);
        const result = {};
        for (const addon of this._addons) {
            if (typeof addon.onTradeOpen === 'function') {
                try {
                    const fields = addon.onTradeOpen(ctx);
                    if (fields && typeof fields === 'object') {
                        result[addon.name] = fields;
                    }
                } catch (e) {
                    console.error(`[TradeAddonManager] "${addon.name}" onTradeOpen error:`, e);
                }
            }
        }
        return result;
    },

    /** Called when a trade is closed. Returns merged addon custom fields. */
    onClose(candles, price, builtinContext, openData) {
        if (this._addons.length === 0) return {};
        const ctx = this._buildCtx(candles, price, builtinContext);
        const result = {};
        for (const addon of this._addons) {
            if (typeof addon.onTradeClose === 'function') {
                try {
                    const openAddonData = openData ? openData[addon.name] : null;
                    const fields = addon.onTradeClose(ctx, openAddonData);
                    if (fields && typeof fields === 'object') {
                        result[addon.name] = fields;
                    }
                } catch (e) {
                    console.error(`[TradeAddonManager] "${addon.name}" onTradeClose error:`, e);
                }
            }
        }
        return result;
    },

    isLoaded() { return this._addons.length > 0; },
    getNames() { return this._addons.map(a => a.name); },
};

// Global registration function used by addon files
if (typeof window !== 'undefined') {
    if (!window.LocalBarReplay) window.LocalBarReplay = {};
    window.LocalBarReplay.registerTradeAddon = (config) => TradeAddonManager.register(config);
}

/* ═══════════════ Trade Context Addon System ═══════════════
 *
 * HIDDEN FEATURE — For developers only.
 * Normal users will never see this unless they open the source code.
 *
 * How to use:
 *   1. Create a .js file that calls LocalBarReplay.registerTradeAddon({ ... })
 *   2. Add a <script src="addons/your_addon.js"></script> to index.html
 *   3. The addon's hooks fire automatically
 *
 * Available hooks:
 *   onTradeOpen(ctx)                    — record data when trade opens
 *   onTradeClose(ctx, openData)         — record data when trade closes
 *   onBeforeTrade(ctx, pos)             — return false to BLOCK a trade
 *   onEveryTick(candle, equity, balance) — called every replay frame
 *   onActivate()                        — called when addon is enabled
 *   onDeactivate()                      — called when addon is disabled
 *
 * ═══════════════════════════════════════════════════════ */

const TradeAddonManager = {
    _addons: [],

    /** Register a new addon. Called by addon files. */
    register(config) {
        if (!config || !config.name) { console.warn('[TradeAddonManager] Addon must have a name.'); return; }
        console.log(`[TradeAddonManager] Addon loaded: "${config.name}"`);
        this._addons.push(config);
        // Fire onActivate if the addon defines it
        if (typeof config.onActivate === 'function') {
            try { config.onActivate(); } catch (e) {
                console.error(`[TradeAddonManager] "${config.name}" onActivate error:`, e);
            }
        }
    },

    /** Unregister an addon by matching source path. */
    unregister(matchFn) {
        const removed = [];
        this._addons = this._addons.filter(a => {
            if (matchFn(a)) {
                // Fire onDeactivate
                if (typeof a.onDeactivate === 'function') {
                    try { a.onDeactivate(); } catch (e) {
                        console.error(`[TradeAddonManager] "${a.name}" onDeactivate error:`, e);
                    }
                }
                removed.push(a.name);
                return false;
            }
            return true;
        });
        if (removed.length) console.log(`[TradeAddonManager] Unloaded: ${removed.join(', ')}`);
    },

    /** Build the context (ctx) object passed to addon hooks. */
    _buildCtx(candles, price, builtinContext) {
        return {
            price,
            candle: candles[candles.length - 1],
            history: candles,
            closedPnl: builtinContext?.closedPnl ?? null,
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

    /**
     * Called BEFORE a trade is placed. If ANY addon returns false, the trade is blocked.
     * @returns {boolean|string} true to allow, or a string with rejection reason
     */
    onBeforeTrade(candles, price, pos) {
        for (const addon of this._addons) {
            if (typeof addon.onBeforeTrade === 'function') {
                try {
                    const result = addon.onBeforeTrade(
                        this._buildCtx(candles, price, {}), pos
                    );
                    if (result === false) return 'Blocked by ' + addon.name;
                    if (typeof result === 'string') return result;
                } catch (e) {
                    console.error(`[TradeAddonManager] "${addon.name}" onBeforeTrade error:`, e);
                }
            }
        }
        return true;
    },

    /**
     * Called on every replay frame (every tick).
     * Addons can check drawdowns, force-close positions, etc.
     */
    onEveryTick(candle, equity, balance) {
        for (const addon of this._addons) {
            if (typeof addon.onEveryTick === 'function') {
                try {
                    addon.onEveryTick(candle, equity, balance);
                } catch (e) {
                    console.error(`[TradeAddonManager] "${addon.name}" onEveryTick error:`, e);
                }
            }
        }
    },

    isLoaded() { return this._addons.length > 0; },
    getNames() { return this._addons.map(a => a.name); },
};

// Global registration function used by addon files
if (typeof window !== 'undefined') {
    if (!window.LocalBarReplay) window.LocalBarReplay = {};
    window.LocalBarReplay.registerTradeAddon = (config) => TradeAddonManager.register(config);
}

# 🧩 Trade Addon Guide

> **Extend LocalBarReplay with custom trade logic — from simple data recording to full prop firm challenge simulations.**

LocalBarReplay includes a **Trade Addon system** that lets developers hook into the trade lifecycle. Addons range from lightweight data recorders to full UI-takeover experiences like the **Maven Prop Firm Simulator**. Enable/disable them from the 📊 Indicators dropdown → 🧩 Trade Addons section.

---

## Why Does This Exist?

Discretionary traders often struggle to explain exactly *why* they took a trade. The addon system solves this by letting you:

- **Record context** — Snapshot market state (indicators, candle anatomy, session) at entry/exit
- **Enforce rules** — Block trades that violate risk management rules
- **Simulate environments** — Run prop firm challenges with real drawdown/target rules
- **Export data** — Download everything as JSON for AI/statistical analysis

**The core app stays lightweight.** All advanced functionality is opt-in via addons.

---

## Architecture

```
┌─────────────────────┐     lifecycle hooks     ┌──────────────────────┐
│   Your Addon File    │ ◄──────────────────────  │   trading.js (core)  │
│                      │                          │                      │
│  onTradeOpen(ctx)    │ ── record data ────────► │  stores with trade   │
│  onTradeClose(ctx)   │ ── record data ────────► │  shows in modal      │
│  onBeforeTrade(ctx)  │ ── return false ───────► │  blocks the trade    │
│  onEveryTick(candle) │ ── check rules ────────► │  force close etc.    │
│  onActivate()        │ ── inject UI ──────────► │                      │
│  onDeactivate()      │ ── restore UI ─────────► │                      │
└─────────────────────┘                          └──────────────────────┘
```

- The **core** (`trading.js`) handles: trade lifecycle, P&L, MFE/MAE, TP/SL, history
- **Addons** add behaviour on top — recording, rule enforcement, UI changes
- Multiple addons can be loaded simultaneously

---

## Available Hooks

### Data Recording Hooks

| Hook | When it fires | What to return |
|---|---|---|
| `onTradeOpen(ctx)` | Trade is placed | Object of fields to record |
| `onTradeClose(ctx, openData)` | Trade is closed | Object of fields to record |

### Control Hooks

| Hook | When it fires | What to return |
|---|---|---|
| `onBeforeTrade(ctx, pos)` | Before trade is created | `true` to allow, `false` or string to block |
| `onEveryTick(candle, equity, balance)` | Every replay frame | Nothing (perform side effects) |

### Lifecycle Hooks

| Hook | When it fires | Purpose |
|---|---|---|
| `onActivate()` | Addon is enabled (loaded) | Inject custom UI, initialize state |
| `onDeactivate()` | Addon is disabled (unloaded) | Clean up UI, restore defaults |

---

## Quick Start

### 1. Create your addon file

```js
// addons/my_addon.js

LocalBarReplay.registerTradeAddon({
    name: 'My Addon',
    _sourcePath: document.currentScript?.src,  // required for dynamic unloading

    onTradeOpen(ctx) {
        return {
            rsi_at_entry: ctx.rsi(14),
            ema4_distance: ctx.price - ctx.ema(4),
        };
    },

    onTradeClose(ctx, openData) {
        return {
            rsi_at_exit: ctx.rsi(14),
        };
    },
});
```

### 2. Register it in the addon selector

Add a checkbox entry in `index.html` inside `#addon-list`:

```html
<label class="addon-toggle">
  <input type="checkbox" data-addon="addons/my_addon.js"> My Addon
</label>
```

### 3. Trade normally

Enable it from the 📊 Indicators dropdown, then trade as normal. Click **Details ▸** on any closed trade to see your addon data. Hit **⬇ Export** to download as JSON.

---

## The `ctx` Object

Your `onTradeOpen`, `onTradeClose`, and `onBeforeTrade` functions receive a `ctx` (context) object — a live snapshot of the chart.

### Price & Candle

| Property | Type | Description |
|---|---|---|
| `ctx.price` | `number` | Price at trade open/close |
| `ctx.candle` | `object` | Current candle `{open, high, low, close, volume, time}` |
| `ctx.history` | `array` | All candles up to this moment |

### Helper Methods

| Method | Returns | Description |
|---|---|---|
| `ctx.ema(period)` | `number` | Current EMA value |
| `ctx.sma(period)` | `number` | Current SMA value |
| `ctx.rsi(period)` | `number` | Current RSI value |
| `ctx.atr(period)` | `number` | Current ATR |
| `ctx.priceInRange(lookback)` | `0-100` | Price position in N-candle range |
| `ctx.prevCandles(n)` | `array` | Last N completed candles |
| `ctx.candlesSinceEMATouch(period)` | `number` | Bars since EMA was touched |
| `ctx.slope(indicatorFn, period, lookback)` | `number` | Indicator change over N bars |

---

## Addon Types

### Type 1: Data Recorders (Simple)

Record market state at trade open/close. No UI changes, no trade blocking.

**Examples:** `full_trade_context.js`, `example_ema_context.js`

```js
LocalBarReplay.registerTradeAddon({
    name: 'My Recorder',
    _sourcePath: document.currentScript?.src,
    onTradeOpen(ctx) { return { rsi: ctx.rsi(14) }; },
    onTradeClose(ctx) { return { rsi: ctx.rsi(14) }; },
});
```

### Type 2: Rule Enforcers (Advanced)

Use `onBeforeTrade` to block trades and `onEveryTick` to monitor conditions.

```js
LocalBarReplay.registerTradeAddon({
    name: 'Max Risk Guard',
    _sourcePath: document.currentScript?.src,

    onBeforeTrade(ctx, pos) {
        // Block trades with no stop loss
        if (!pos.sl) return 'Stop loss required!';
        return true;
    },

    onEveryTick(candle, equity, balance) {
        // Force close everything if equity drops below threshold
        if (equity < balance * 0.95) {
            TradingEngine.closeAll(candle.close);
        }
    },
});
```

### Type 3: UI Takeover (Full Experience)

Use `onActivate`/`onDeactivate` to completely transform the interface. The **Maven Prop Firm** addon is an example of this.

```js
let _origHTML = null;

LocalBarReplay.registerTradeAddon({
    name: 'My Experience',
    _sourcePath: document.currentScript?.src,

    onActivate() {
        const el = document.getElementById('account-info');
        _origHTML = el.innerHTML;
        el.innerHTML = '<div>My Custom HUD</div>';
        document.body.classList.add('my-addon-active');
    },

    onDeactivate() {
        const el = document.getElementById('account-info');
        if (_origHTML) el.innerHTML = _origHTML;
        document.body.classList.remove('my-addon-active');
    },

    onEveryTick(candle, equity, balance) {
        // Update your custom HUD every frame
    },
});
```

---

## Included Addons

### 🏢 `addons/maven_prop_firm.js` — Maven Prop Firm Simulator

Simulates the full Maven Trading prop firm challenge experience. Supports all 4 account types:

| Plan | Phases | Daily DD | Max DD | Profit Target |
|---|---|---|---|---|
| **1-Step** | 1 phase → Funded | 3% (equity) | 5% (trailing) | 8% |
| **2-Step** | 2 phases → Funded | 4% (equity) | 8% (static) | 8% → 5% |
| **3-Step** | 3 phases → Funded | 2% (equity) | 3% (static) | 3% → 3% → 3% |
| **Instant** | Direct Funded | 2% (equity) | 3% (trailing) | None |

**Features:**
- Takes over the account section with a live HUD (progress bars, drawdown meters, profitable day dots)
- Enforces daily drawdown, max drawdown, and profit targets
- Tracks profitable trading days (≥0.5% of initial balance)
- Instant Funding mode includes consistency score and max floating loss checks
- Phase transitions (Phase 1 → Phase 2 → Funded)
- Breach detection with clear reason display
- Restart challenge button

### 📊 `addons/full_trade_context.js` — Full Trade Context

Records ~30 technical fields at entry and exit including EMAs, RSI, MACD, ATR, Bollinger Bands, candle anatomy, volume ratios, and trend direction.

### 📈 `addons/example_ema_context.js` — EMA Strategy Context

Lightweight addon focused on EMA confluence — distances to EMA(4/9/21/50), stack alignment, and RSI.

---

## Multiple Addons

You can enable as many addons as you want. Each appears as its own section in the trade detail modal and JSON export:

```json
{
  "addonData": {
    "Full Trade Context": { "ema4Distance": -12.4, "rsi": 58.2 },
    "My Session Tracker": { "session": "London" }
  }
}
```

> **Note:** UI-takeover addons (like Maven Prop Firm) modify the sidebar. Running multiple UI-takeover addons simultaneously may conflict. Stick to one at a time.

---

## Creating Your Own Addon — Full Template

```js
/**
 * My Addon — [what it does]
 * To enable: check it in Indicators → 🧩 Trade Addons
 */

LocalBarReplay.registerTradeAddon({
    name: 'My Addon',
    version: '1.0',
    _sourcePath: document.currentScript?.src,

    // Called when addon is loaded
    onActivate() {},

    // Called when addon is unloaded
    onDeactivate() {},

    // Called before every trade — return false to block
    onBeforeTrade(ctx, pos) { return true; },

    // Called on every replay frame
    onEveryTick(candle, equity, balance) {},

    // Record data at trade open
    onTradeOpen(ctx) { return {}; },

    // Record data at trade close
    onTradeClose(ctx, openData) { return {}; },
});
```

---

## FAQ

**Q: Does this affect normal users who just open index.html?**
No. Without any addon enabled, the system is completely invisible — zero extra UI, zero computation.

**Q: Will this slow down the replay?**
Data recorders compute only on trade open/close. Rule enforcers and `onEveryTick` hooks run every frame but are lightweight. The Maven Prop Firm addon updates its HUD every tick with negligible overhead.

**Q: Can I access raw candle data?**
Yes. `ctx.history` is the full candle array. `ctx.candle` is the current one.

**Q: Can I use the Indicators module directly?**
Yes. `Indicators.ema(ctx.history, 9)` works inside addons — but prefer `ctx.ema(9)` for cleanliness.

**Q: Can an addon modify TradingEngine state?**
Yes. `TradingEngine.balance`, `TradingEngine.positions`, `TradingEngine.closeAll(price)` are all accessible. The Maven Prop Firm addon uses this to set account size and force-close on breach.

**Q: Where is the data stored?**
In memory only. Use **⬇ Export** to download as JSON before refreshing. The Maven Prop Firm addon stores challenge preferences in localStorage.

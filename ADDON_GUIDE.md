# 🧩 Trade Context Addon Guide

> **Record anything about your trades — market conditions, indicator values, visual context — as structured data you can export and analyse.**

LocalBarReplay includes a **Trade Context Addon system** that lets you attach custom data to every trade. When you close a trade, that data travels with it into the history and can be exported as JSON. Completely hidden from normal users — only active if you add a script tag.

---

## Why Does This Exist?

Discretionary traders (people who read charts visually) often struggle to explain exactly *why* they took a trade. You see the chart, something clicks, and you place the order — but how do you study that later? How do you feed it into a model?

The addon system solves this by automatically snapshotting the market state at the moment you enter and exit every trade. You define *what* to record. The system handles *when* and *how*.

**Practical use cases:**
- Record EMA distances to find the exact "distance" that triggers your entries
- Feed exported JSON directly into an AI to identify patterns in your decisions
- Compare what the market looked like on winning vs losing trades
- Build a statistical model of your own strategy without changing a line of the core app

---

## Architecture

```
┌─────────────────────┐        trade open / close        ┌──────────────────────┐
│   Your Addon File    │ ◄──────────────────────────────  │   trading.js (core)  │
│                      │                                   │                      │
│  onTradeOpen(ctx)   │ ── returns { your fields } ────►  │  stores with trade   │
│  onTradeClose(ctx)  │ ── returns { your fields } ────►  │  shows in modal      │
└─────────────────────┘                                   │  exports in JSON     │
                                                          └──────────────────────┘
```

- The **core** (`trading.js`) always tracks: side, lots, leverage, entry/exit price, TP/SL, MFE, MAE, duration
- Your **addon** adds any extra fields you want — the core doesn't care what they are
- Multiple addons can be loaded simultaneously — each gets its own named section in the detail modal and the JSON export

---

## Quick Start

### 1. Create your addon file

```js
// addons/my_addon.js

LocalBarReplay.registerTradeAddon({
    name: 'My Addon',

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

### 2. Add the script tag to `index.html`

Add this line **after** `tradeaddons.js` and before `app.js`:

```html
<!-- Addon system -->
<script src="js/tradeaddons.js"></script>

<!-- Your addon (add this line) -->
<script src="addons/my_addon.js"></script>

<script src="js/app.js"></script>
```

### 3. Trade normally

Open trades as normal. When you close one, click **Details ▸** in the History panel to see your addon's data. Hit **⬇ Export** to download everything as JSON.

> **For normal users:** If no addon script tags are present, the system is completely invisible — the addon manager loads but does nothing.

---

## The `ctx` Object

Your `onTradeOpen` and `onTradeClose` functions receive a `ctx` (context) object. This is a live snapshot of the chart at the moment the trade opened or closed.

### Price & Candle

| Property | Type | Description |
|---|---|---|
| `ctx.price` | `number` | Price at trade open/close |
| `ctx.candle` | `object` | Current candle `{open, high, low, close, volume, time}` |
| `ctx.history` | `array` | All candles up to this moment (most recent last) |

### Helper Methods

#### `ctx.ema(period)` → `number | null`
Get the current EMA value for any period.
```js
const ema4 = ctx.ema(4);
const ema21 = ctx.ema(21);
```

#### `ctx.sma(period)` → `number | null`
Same as above for SMA.

#### `ctx.rsi(period)` → `number | null`
Current RSI value.
```js
const rsi = ctx.rsi(14); // → 62.4
```

#### `ctx.atr(period)` → `number | null`
Current ATR (Average True Range).
```js
const atr = ctx.atr(14);
```

#### `ctx.priceInRange(lookback)` → `number`
Where is price in the last N candles' range? Returns 0–100.
- `0` = at the bottom of the range
- `100` = at the top
- `50` = dead middle
```js
const pct = ctx.priceInRange(50); // → 73.2
```

#### `ctx.prevCandles(n)` → `array`
Get the last N completed candles (excludes the current one).
```js
const last5 = ctx.prevCandles(5);
```

#### `ctx.candlesSinceEMATouch(period)` → `number | null`
How many candles ago did price last touch (cross through) this EMA?
```js
const bars = ctx.candlesSinceEMATouch(4); // → 3
```

#### `ctx.slope(indicatorFn, period, lookback)` → `number | null`
How much has an indicator moved over the last N candles?
```js
// EMA(4) change over last 3 candles
const slope = ctx.slope((d, p) => Indicators.ema(d, p), 4, 3);
```

---

## The `openData` Argument

`onTradeClose` receives a second argument: `openData`. This is exactly what your `onTradeOpen` returned, so you can compare entry and exit conditions:

```js
onTradeClose(ctx, openData) {
    const rsiNow = ctx.rsi(14);
    const rsiAtEntry = openData?.rsi_at_entry;
    return {
        rsi_at_exit: rsiNow,
        rsi_change: rsiNow !== null && rsiAtEntry !== null
            ? +(rsiNow - rsiAtEntry).toFixed(2)
            : null,
    };
}
```

---

## What to Return

Return any flat object with any keys and values you want recorded. Numbers, strings, booleans — all fine. Nested objects are supported but will be stringified in the detail modal display.

```js
onTradeOpen(ctx) {
    return {
        // numbers
        ema4: ctx.ema(4),
        ema4_dist_pct: +(((ctx.price - ctx.ema(4)) / ctx.ema(4)) * 100).toFixed(4),
        // booleans
        above_ema21: ctx.price > ctx.ema(21),
        // strings
        session: ctx.candle.time % 86400 < 43200 ? 'AM' : 'PM',
        // derived
        rsi_zone: ctx.rsi(14) > 70 ? 'overbought' : ctx.rsi(14) < 30 ? 'oversold' : 'neutral',
    };
}
```

---

## Viewing the Data

After placing and closing trades:

1. Look at the **History** section in the trading panel
2. Click **Details ▸** on any trade card
3. The detail modal shows:
   - **Trade Summary** — core fields (price, P&L, MFE, MAE, duration)
   - **Your Addon Name — at Open** — everything your `onTradeOpen` returned
   - **Your Addon Name — at Close** — everything your `onTradeClose` returned

To export:
- **Export This Trade** (in the detail modal) — downloads that single trade as JSON
- **⬇ Export** (in the History header) — downloads all closed trades as JSON

---

## Included Addons

### `addons/full_trade_context.js`

A comprehensive market snapshot recorder. Records at every trade open and close:

| Field | Description |
|---|---|
| `datetime` | Human-readable timestamp |
| `dayOfWeek`, `hourOfDay` | Time context |
| `timeframe` | Active chart timeframe |
| `price` | Entry/exit price |
| `ema4`, `ema4Distance`, `ema4DistancePct` | EMA(4) proximity |
| `ema4Slope` | EMA(4) direction over 3 candles |
| `ema4TouchCandles` | Bars since price last touched EMA(4) |
| `ema12`, `ema26`, `sma20`, `sma50` | All active indicators |
| `rsi`, `macdLine`, `macdSignal`, `macdHistogram` | Momentum |
| `bbUpper/Middle/Lower`, `bbWidth`, `bbPosition` | Bands |
| `atr14` | Volatility |
| `trendDirection` | `up` / `down` / `sideways` (SMA20 slope) |
| `priceInRange50` | Price percentile in 50-candle range |
| `candleBodyRatio`, `wickRatio`, `gapFromPrevClose` | Candle anatomy |
| `volumeRatio` | Volume vs 20-candle average |

To enable, add to `index.html`:
```html
<script src="addons/full_trade_context.js"></script>
```

### `addons/example_ema_context.js`

A lighter addon focused specifically on EMA confluence analysis — EMA(4/9/21/50) distances, stack alignment (bullish/bearish ordering), slope, and RSI. Good starting template to copy and modify.

---

## Multiple Addons

You can load as many addons as you want. Each appears as its own section in the detail modal:

```html
<script src="addons/full_trade_context.js"></script>
<script src="addons/my_session_tracker.js"></script>
<script src="addons/my_pattern_detector.js"></script>
```

The exported JSON will contain a key per addon:

```json
{
  "addonData": {
    "Full Trade Context": {
      "ema4Distance": -12.4,
      "rsi": 58.2,
      "_close": { "ema4Distance": 3.1, "rsi": 44.7 }
    },
    "My Session Tracker": {
      "session": "London",
      "_close": { "session": "NY" }
    }
  }
}
```

---

## Creating Your Own Addon — Template

```js
/**
 * My Addon — [describe what it records]
 *
 * To enable: <script src="addons/my_addon.js"></script>
 */

LocalBarReplay.registerTradeAddon({
    name: 'My Addon',
    version: '1.0',

    onTradeOpen(ctx) {
        // ctx is fully available here
        // Return any object — these fields are recorded with the trade
        return {
            // your fields here
        };
    },

    onTradeClose(ctx, openData) {
        // openData is what you returned from onTradeOpen
        // ctx reflects market state at exit
        return {
            // your fields here
        };
    },
});
```

---

## FAQ

**Q: Does this affect normal users who just open index.html?**
No. Without an addon script tag, `TradeAddonManager` loads but stays dormant. Zero extra UI, zero extra computation.

**Q: Will this slow down the replay?**
Minimally. Context is only computed when a trade is opened or closed, not on every tick.

**Q: Can I access raw candle data in my addon?**
Yes. `ctx.history` is the full array of all candles up to that point. `ctx.candle` is the current one.

**Q: Can I compute my own custom indicator?**
Yes — `ctx.history` gives you the raw OHLCV array. Compute whatever you want on it.

**Q: Where is the data stored?**
In memory only (in the browser tab). Use **⬇ Export** to download it as JSON before refreshing.

**Q: Can I use the Indicators module directly?**
Yes. Inside your addon, `Indicators.ema(ctx.history, 9)` works — but prefer the `ctx.ema(9)` shorthand for cleanliness.

# LocalBarReplay — Development Documentation

This document covers the full thought process, architecture, and every feature built for the LocalBarReplay project.

---

## 1. Project Goal

Build a standalone, browser-only bar replay tool that works like TradingView's bar replay but runs locally with no account or backend. Targeted at crypto and forex traders who want to practice and backtest strategies on historical data.

The secondary goal was to make this extensible for ML/quant developers by adding a bridge API, so they could connect their Python models directly to the chart.

---

## 2. Architecture

The entire app is a single `index.html` file loading vanilla JS modules and one CSS file. No build step, no bundler, no framework.

```
index.html
├── css/styles.css          (dark TradingView theme, all layout + component styles)
├── js/db.js                (IndexedDB wrapper for candle data caching)
├── js/data.js              (Binance API fetcher + CSV parser)
├── js/aggregation.js       (5m → any timeframe OHLCV aggregation)
├── js/indicators.js        (SMA, EMA, BB, RSI, MACD computations)
├── js/pinescript.js         (custom indicator interpreter)
├── js/chart.js             (TradingView Lightweight Charts wrapper, click-to-pick TP/SL)
├── js/trading.js           (trade simulation engine, P&L, position management)
├── js/replay.js            (playback engine — timer, frame rendering, open-only mode)
├── js/bridge.js            (WebSocket client for Python ML bridge)
├── js/app.js               (main wiring — events, tabs, modals, boot)
└── sdk/
    ├── localbarreplay.py   (Python WebSocket server SDK)
    ├── example_sma_crossover.py
    └── example_orderblock.py
```

### Data Flow

1. User picks a symbol and date, clicks Fetch
2. `data.js` calls Binance API, auto-paginates, returns 5-minute OHLCV array
3. `db.js` caches the data in IndexedDB keyed by symbol+date
4. `aggregation.js` converts 5m data to user-selected timeframe (15m, 1h, 4h, etc.)
5. `replay.js` slices the aggregated array at `replayIndex` and feeds it to the chart
6. `chart.js` renders candles + indicators via Lightweight Charts v5
7. `trading.js` checks TP/SL on each tick and manages positions

---

## 3. Feature Breakdown

### 3.1 Data Fetching and Caching

**Design decision:** Always fetch 5-minute data regardless of what timeframe the user selects. This means if someone loads 1h data and later switches to 5m, the raw data is already there — no re-fetch needed. The aggregation is done client-side in real time.

**Caching:** Every fetch is stored in IndexedDB with a composite key of `symbol + date`. If the same combination is requested again, it reads from cache instantly. This was specifically requested by the user.

**CSV support:** The parser auto-detects common column names (date/time, open, high, low, close, volume). If auto-detection fails, a modal lets the user manually map columns. This handles MT5 exports and custom data.

### 3.2 Multi-Timeframe Aggregation

`aggregation.js` groups 5-minute candles into buckets determined by the target timeframe. For each bucket:
- `open` = first candle's open
- `high` = max of all highs
- `low` = min of all lows
- `close` = last candle's close
- `volume` = sum of all volumes
- `time` = first candle's timestamp

When the user switches timeframes, the replay engine finds the closest candle index in the new aggregation to maintain the same moment in time. This was a specific user requirement — switching from 1h to 5m should land on the same point in history.

### 3.3 Replay Engine

The replay engine (`replay.js`) maintains a `replayIndex` pointer into the aggregated candle array. On each frame:

1. Slice `candles[0..replayIndex]` as the visible data
2. If **open-only mode** is active, flatten the last candle (set high=low=close=open)
3. Pass to `chart.js` for rendering
4. Check TP/SL hits via `trading.js`
5. Update position lines on chart
6. Emit candle event to bridge (if connected)
7. Update progress bar, bar counter, datetime display

**Speed control:** Uses `setInterval` with `1000 / speed` ms. Speed ranges from 0.5x to 20x.

**Open-only mode:** Added as the last feature. When toggled on (the "O" button in the replay bar), each new candle shows only its opening price. The candle appears as a flat line at the open until the user steps forward, at which point the next candle opens. This is useful for practicing entries based solely on the open without being influenced by how the candle closes. When toggled off, the candle renders normally with full OHLC. The current price for trading uses `open` instead of `close` in this mode.

### 3.4 Chart Manager

Wraps TradingView Lightweight Charts v5. Manages:
- Main candlestick chart
- Volume sub-chart
- RSI sub-chart (created/destroyed on demand)
- MACD sub-chart (created/destroyed on demand)
- 8 indicator line series (SMA x2, EMA x2, BB x3 for upper/middle/lower)
- Custom PineScript series
- Entry/TP/SL price lines for open positions

**Click-to-pick TP/SL:** When the user clicks the target button next to the TP or SL input, the chart enters "pick mode" — cursor changes to crosshair, a click anywhere on the chart reads the price at that Y coordinate and fills the corresponding input. ESC or clicking the target button again cancels. This replaced an earlier drag-handle system that was unreliable.

**Time scale sync:** All sub-charts (volume, RSI, MACD) sync their visible range to the main chart's time scale.

### 3.5 Trading Simulation

The trading engine (`trading.js`) simulates market orders with:
- Configurable lot size (min 0.01) or USDT amount (auto-converted to lots)
- Leverage from 1x to 125x
- Take profit and stop loss
- Real-time unrealized P&L calculation

**Position management:** Each position tracks entry price, side, lots, leverage, TP, SL, symbol, and an EMA snapshot at entry time. On close, another EMA snapshot is captured. Both snapshots are stored in the trade history.

**Instant fill:** Orders fill immediately regardless of whether the chart is playing or paused. After placing or closing a trade, the replay engine forces a re-render frame so position lines and trade cards update instantly.

**TP/SL execution:** On every tick (candle), the engine checks each open position. For longs: if `high >= tp`, close at TP price; if `low <= sl`, close at SL price. For shorts: inverse logic. The check uses high/low rather than close to catch intra-candle wicks.

### 3.6 Built-in Indicators

`indicators.js` computes:

| Indicator | Algorithm |
|---|---|
| SMA | Simple moving average over N periods |
| EMA | Exponential moving average with multiplier `2/(N+1)` |
| Bollinger Bands | SMA(period) ± mult * stddev |
| RSI | Wilder's smoothing method |
| MACD | EMA(fast) - EMA(slow), signal = EMA of MACD line |
| Volume | Direct histogram from candle volume |

Each indicator has configurable parameters (period, multiplier, fast/slow). SMA and EMA each have two lines that can be individually toggled on/off. All config is done via the inline indicator menu dropdown.

### 3.7 PineScript Interpreter

`pinescript.js` is a mini-interpreter that supports a subset of PineScript v5:
- `ta.sma(source, length)`, `ta.ema(source, length)`, `ta.rsi(source, length)`
- Series: `close`, `open`, `high`, `low`, `volume`
- `plot(value, title=, color=)`
- `input.int(defval, title=)`, `input.float(defval, title=)`
- Basic math: `+`, `-`, `*`, `/`
- Variable assignment

Scripts are stored in `localStorage` with a unique ID. They persist across sessions and can be toggled, edited, or deleted. Each script produces one or more line series on the main chart.

### 3.8 WebSocket Bridge (ML Integration)

**Why WebSocket:** The user wanted to connect external ML models to the chart. Since the app is browser-only, a WebSocket is the simplest bidirectional channel. The Python side runs a server, the browser connects as a client.

**How it works:**
1. `bridge.js` tries to connect to `ws://localhost:9876` on page load
2. If nothing's listening, it silently fails. No error, no UI change.
3. If a Python script is running, it connects and the bridge status icon appears
4. Auto-reconnect every 3 seconds if the connection drops

**Command types (Python → Chart):**
- Drawing: `draw_marker`, `draw_box`, `draw_line`, `draw_hline`, `draw_text`, `highlight_candle`, `remove_drawing`, `clear_drawings`
- Trading: `place_trade`, `close_trade`, `close_all`, `modify_trade`
- Data queries: `get_candles`, `get_indicator`, `get_current_price`, `get_account`, `get_positions`, `get_trade_history`, `get_replay_state`
- UI: `notify`, `log`, `add_button`, `set_panel_html`

**Events (Chart → Python):**
- `candle` — on every new candle during replay
- `trade_open` / `trade_close` — when positions change
- `replay_state` — play/pause/stop
- `timeframe_change` — when user switches TF
- `button_click` — when custom buttons are clicked

**Python SDK:** `sdk/localbarreplay.py` provides a clean decorator-based API:
```python
@bridge.on_candle
async def handler(candle, history):
    ...
```

All commands are async and return results via request-response messaging over the WebSocket.

---

## 4. Design Decisions

### Why no framework?
The user wanted something that works by opening a file. No npm, no build, no server. Vanilla JS with script tags keeps it dead simple and instantly runnable.

### Why Lightweight Charts v5?
It's the open-source version of TradingView's charting library. Renders fast, looks professional, handles large datasets well, and the API is clean.

### Why always fetch 5-minute data?
Fetching at the lowest useful timeframe means the user never needs to re-fetch when switching timeframes. The aggregation happens instantly in JavaScript.

### Why IndexedDB instead of localStorage?
Candle data can be megabytes. localStorage has a 5-10MB limit. IndexedDB handles hundreds of megabytes and supports structured data natively.

### Why click-to-pick instead of drag handles for TP/SL?
The original implementation used DOM overlay elements that could be dragged on the chart. This conflicted with the chart's own pan/scroll behavior and was unreliable across browsers. Click-to-pick is simpler: one click to enter pick mode, one click to set the price. No fighting with the chart library's event system.

### Why WebSocket for the ML bridge?
The alternatives were:
- HTTP polling (too slow, awkward for real-time events)
- postMessage (requires iframes, messy)
- WebRTC (overkill)

WebSocket gives full duplex communication over a single connection with sub-millisecond latency on localhost. The Python `websockets` library makes the server trivial.

---

## 5. File-by-File Reference

### `js/db.js` (IndexedDB Cache)
Simple wrapper. `saveCandles(key, data)` and `loadCandles(key)`. Uses one object store with the key being `symbol_date` (e.g., `BTCUSDT_2024-01-01`). Stores the raw 5-minute OHLCV array.

### `js/data.js` (Binance API + CSV)
`fetchAllBinanceData(symbol, startDate)` — calls Binance klines API with 5m interval, 1000 candles per page, auto-paginates until it reaches the current time. Returns normalized `{time, open, high, low, close, volume}` objects where time is Unix seconds.

CSV parser: reads text, splits by newline and comma/tab, returns `{headers, rows}`. Column mapper tries matching common names (date, time, open, high, low, close, volume, Date, Time, Open, High, Low, Close, Volume, etc.).

### `js/aggregation.js` (Timeframe Conversion)
`aggregate(base5mCandles, tfMinutes)` — groups candles into target-timeframe buckets. `findClosestIndex(aggregated, timestamp)` — binary search for the nearest candle to a given time, used during TF switches.

### `js/indicators.js` (Technical Indicators)
Pure functions. Each takes a candle array and returns `[{time, value}]`. No side effects. MACD returns `{macdLine, signalLine, histogram}`. Bollinger Bands returns `{upper, middle, lower}`.

### `js/pinescript.js` (PineScript Interpreter)
Line-by-line parser. Tokenizes each line, resolves function calls, evaluates arithmetic, stores results for plotting. Scripts stored as `{id, name, code, enabled}` in `localStorage` under key `pine_scripts`.

### `js/chart.js` (Chart Manager)
Singleton. Creates main chart + sub-charts. Manages all series. Key methods:
- `init()` — create charts, set up click-to-pick handler
- `updateData(candles, indicatorState)` — set all series data
- `enterPickMode(field)` / `exitPickMode()` — crosshair click mode for TP/SL
- `updatePositionLines(positions, price)` — draw/update entry/TP/SL price lines
- `getEMASnapshot(candles)` — get current EMA values for trade history

### `js/trading.js` (Trading Engine)
Singleton. Manages `positions[]` and `history[]`. Key methods:
- `openPosition(side, lots, leverage, price, tp, sl, symbol)` — create position with EMA snapshot
- `closePosition(id, price)` — close with EMA snapshot, calculate P&L
- `onTick(candle)` — check all TP/SL against candle high/low
- `closeAll(price)` — close everything
- `updateUI()` — render position cards and history cards

### `js/replay.js` (Playback Engine)
Singleton. Manages replay state. Key properties:
- `baseData` — raw 5m candles
- `currentTF` — current timeframe in minutes
- `replayIndex` — current position in aggregated array
- `openOnly` — when true, flattens current candle to open price
- `speed` — playback multiplier

Key methods:
- `loadData(data, tf)` — load candles and start
- `switchTimeframe(tf)` — re-aggregate and find closest index
- `_renderFrame(fitContent)` — core render cycle
- `getCurrentPrice()` — returns open or close based on openOnly mode

### `js/bridge.js` (WebSocket Client)
Singleton `BridgeClient`. Connects to `ws://localhost:9876`, handles command dispatch, manages subscriptions, auto-reconnects. Invisible when no server is running.

### `js/app.js` (Main Application)
IIFE that runs on DOMContentLoaded. Wires all DOM events: tabs, fetch button, CSV upload, timeframe selector, open-only toggle, indicator menu, trading panel, pick-from-chart buttons, modals, etc. Calls `boot()` which initializes all engine singletons.

---

## 6. Changelog (Session History)

### Phase 1 — Core Replay
- Set up project structure with `index.html`, CSS, and JS modules
- Built Binance data fetcher with auto-pagination
- Created IndexedDB caching layer
- Implemented aggregation engine for multi-timeframe support
- Built replay engine with play/pause, step, speed control
- Rendered charts with TradingView Lightweight Charts v5

### Phase 2 — Trading Simulation
- Added trading panel with buy/sell tabs
- Implemented lot sizing, USDT amount conversion, leverage selection
- Added take-profit and stop-loss with price inputs
- Built P&L tracking with balance, equity, unrealized P&L
- Added position cards with close buttons and trade history

### Phase 3 — Indicators and Customization
- Built 6 built-in indicators (SMA, EMA, BB, RSI, MACD, Volume)
- Made all indicator parameters editable inline
- Created PineScript mini-interpreter for custom indicators
- Added indicator persistence via localStorage

### Phase 4 — TP/SL and Trade UX
- Initially built DOM drag handles for TP/SL (scrapped due to reliability)
- Replaced with click-to-pick system (crosshair cursor, click to set price)
- Made orders fill instantly regardless of play/pause state
- Added EMA snapshots at trade entry and close
- Built detailed history modal with full trade data

### Phase 5 — ML Bridge
- Designed WebSocket bridge architecture
- Built `js/bridge.js` — client with 20+ command handlers
- Built `sdk/localbarreplay.py` — Python SDK with async server and decorator API
- Created example strategies (SMA crossover, order block detector)
- Wrote full API documentation in `ML_INTEGRATION_GUIDE.md`

### Phase 6 — Polish
- Added open-only toggle mode for practicing on candle opens
- Wrote project README
- Pushed to GitHub at `torzodmc/LocalBarReplay`

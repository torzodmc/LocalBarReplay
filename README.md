# LocalBarReplay

A local-first bar replay and trading simulator built entirely in the browser. Load historical crypto data from Binance (or your own CSV), replay it candle by candle, and simulate trades with realistic lot sizing, leverage, and TP/SL — all without any backend or account.

---

## Overview

LocalBarReplay is a standalone charting tool that lets you replay historical market data and practice trading on it. It pulls 5-minute candle data from Binance's public API, caches it locally, and plays it back at configurable speeds. You can place simulated buy/sell orders, set take-profit and stop-loss by clicking directly on the chart, and track your P&L across a full session.

The app also includes a WebSocket bridge that lets developers connect external Python scripts — ML models, custom scanners, automated strategies — directly to the chart. The bridge is invisible to normal users and only activates when a Python script is running.

There's no build step. Open `index.html` in a browser and you're good to go.

---

## Features

**Replay Engine**
- Play, pause, step forward/back, scrub to any point
- Speed control from 0.5x to 20x
- Switch timeframes (5m to 1D) mid-replay without losing your position
- Open-only mode: toggle the **O** button to see only the candle's opening price before it plays out

**Trading Simulation**
- Market orders with configurable lot size or USDT amount
- Leverage from 1x to 125x
- Click-to-set TP/SL: hit the target button, click on chart, price fills in
- Orders fill instantly regardless of play/pause state
- Real-time balance, equity, P&L tracking
- Detailed trade history with EMA values at entry and exit

**Indicators**
- SMA, EMA (dual-line, individually toggleable)
- Bollinger Bands, RSI, MACD, Volume
- All parameters are editable inline
- Custom indicators via a built-in PineScript interpreter (persisted in localStorage)

**Data**
- Binance API with auto-pagination
- CSV import with column auto-detection and manual mapping
- IndexedDB caching — fetch once, replay forever

**ML Bridge** (for developers)
- WebSocket bridge on `localhost:9876`
- Python SDK with event-driven API
- Draw markers, boxes (order blocks), lines on the chart
- Auto-place and manage trades from Python
- Full docs in [`ML_INTEGRATION_GUIDE.md`](ML_INTEGRATION_GUIDE.md)

---

## Getting Started

1. Clone the repo
2. Open `index.html` in your browser
3. Pick a symbol, set a start date, click **Fetch from Binance**
4. Press play

For CSV data, use the **Load CSV** tab and map your columns.

---

## Trading — Setting TP/SL from the Chart

Next to the TP and SL inputs there's a target button. Click it, and the cursor changes to a crosshair. Click anywhere on the chart to set that price. Press Escape to cancel.

---

## Custom Indicators (PineScript)

Open the indicator menu and click **+ Add** at the bottom. The interpreter supports:

```
fast = ta.sma(close, 9)
slow = ta.sma(close, 21)
plot(fast, title="Fast", color=orange)
plot(slow, title="Slow", color=aqua)
```

Supported functions: `ta.sma()`, `ta.ema()`, `ta.rsi()`, `plot()`, series references (`close`, `open`, `high`, `low`, `volume`), basic math, and variable assignment.

---

## ML Model Integration

The bridge is designed for developers who want to connect their own models to the chart. It's completely hidden from the UI unless a Python script is actively connected.

```python
from sdk.localbarreplay import Bridge

bridge = Bridge()

@bridge.on_candle
async def on_candle(candle, history):
    prediction = model.predict(extract_features(history))
    if prediction > 0.7:
        await bridge.draw_marker(candle['time'], candle['low'],
                                  shape='arrowUp', color='#26a69a', text='Signal')
        await bridge.place_trade(side='buy', lots=0.1)

bridge.run()
```

Run `pip install websockets`, start your script, and open `index.html`. The chart auto-connects.

Full API reference with 20+ commands, event hooks, and integration examples for XGBoost, TensorFlow, and ONNX: [`ML_INTEGRATION_GUIDE.md`](ML_INTEGRATION_GUIDE.md)

---

## Project Structure

```
LocalBarReplay/
├── index.html                  # Entry point — open in browser
├── README.md
├── ML_INTEGRATION_GUIDE.md     # Full ML bridge API docs
├── css/styles.css              # Dark theme
├── js/
│   ├── app.js                  # App wiring and event handling
│   ├── chart.js                # Chart rendering, click-to-pick TP/SL
│   ├── replay.js               # Playback engine
│   ├── trading.js              # Trade simulation, P&L, history
│   ├── indicators.js           # Built-in indicators
│   ├── pinescript.js            # PineScript interpreter
│   ├── bridge.js               # WebSocket client for ML bridge
│   ├── data.js                 # Binance API, CSV parsing
│   ├── aggregation.js          # Multi-timeframe aggregation
│   └── db.js                   # IndexedDB caching
└── sdk/
    ├── localbarreplay.py        # Python bridge SDK
    ├── example_sma_crossover.py # SMA crossover strategy example
    └── example_orderblock.py    # Order block detector example
```

## Tech Stack

- [TradingView Lightweight Charts v5](https://github.com/nicktradingview/lightweight-charts) for charting
- Vanilla JS — no frameworks, no build tools
- Binance public API for market data
- IndexedDB + localStorage for persistence
- Python `websockets` for the ML bridge
- [Inter](https://fonts.google.com/specimen/Inter) typeface

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play / Pause |
| Arrow Right | Step forward |
| Arrow Left | Step back |
| + | Speed up |
| - | Speed down |
| Home | Jump to start |
| End | Jump to end |
| Escape | Cancel TP/SL pick |

## Requirements

- Modern browser (Chrome, Firefox, Edge)
- Internet for initial data fetch (works offline after)
- Python 3.7+ with `websockets` for the ML bridge (optional)

## License

MIT

# 🧩 ML Model Integration Guide

> **Connect your Python ML models, trading strategies, and analysis tools to LocalBarReplay's chart in real-time.**

LocalBarReplay includes a built-in **WebSocket bridge** that lets Python scripts communicate with the chart. Your ML model runs in Python — the bridge handles all the communication. No server setup needed.

---

## Quick Start

### 1. Install the dependency

```bash
pip install websockets
```

### 2. Write your strategy

```python
from sdk.localbarreplay import Bridge

bridge = Bridge()

@bridge.on_candle
async def on_candle(candle, history):
    # Your ML model logic here
    if candle['close'] > candle['open']:
        await bridge.draw_marker(candle['time'], candle['low'],
                                  shape='arrowUp', color='#26a69a', text='Signal')

bridge.run()
```

### 3. Run it

```bash
python my_strategy.py
```

### 4. Open the chart

Open `index.html` in your browser. When the bridge connects, a **🧩 Bridge** button appears in the header with a green pulse indicator.

> **For normal users:** If no Python bridge is running, the chart works exactly as before — zero extra UI, zero errors. The bridge is completely invisible unless activated.

---

## Architecture

```
┌────────────────────┐         WebSocket          ┌──────────────────────┐
│   Python Script     │ ◄──── ws://localhost:9876 ──── │   LocalBarReplay     │
│                     │                            │   (index.html)        │
│  • Your ML model    │ ──── JSON commands ────►  │  • Draws on chart     │
│  • XGBoost/TF/ONNX  │                            │  • Places trades      │
│  • Custom logic      │ ◄──── Candle events ─────  │  • Sends candle data  │
└────────────────────┘                            └──────────────────────┘
```

- **Chart → Python:** Sends candle data, trade events, button clicks
- **Python → Chart:** Drawing commands, trade orders, UI updates

---

## API Reference

### Event Decorators

Register handlers that are called when specific events occur.

#### `@bridge.on_candle`
Called on **every new candle** during replay. This is your main entry point for real-time analysis.

```python
@bridge.on_candle
async def handler(candle: dict, history: list[dict]):
    # candle = {time, open, high, low, close, volume}
    # history = all candles from start to current point
    pass
```

#### `@bridge.on_trade_open`
Called when any trade is opened (by user or by bridge).

```python
@bridge.on_trade_open
async def handler(data: dict):
    # data = {id, side, lots, entry_price, tp, sl}
    pass
```

#### `@bridge.on_trade_close`
Called when a trade is closed.

```python
@bridge.on_trade_close
async def handler(data: dict):
    # data = {id, side, lots, entry_price, exit_price, pnl}
    pass
```

#### `@bridge.on_replay_state`
Called when replay play/pause state changes.

```python
@bridge.on_replay_state
async def handler(data: dict):
    # data = {is_playing, index, total, speed, timeframe}
    pass
```

#### `@bridge.on_timeframe_change`
Called when user switches timeframe.

```python
@bridge.on_timeframe_change
async def handler(data: dict):
    # data = {timeframe}  (in minutes: 5, 15, 60, 240, etc.)
    pass
```

#### `@bridge.on_button(button_id)`
Called when a custom button is clicked.

```python
@bridge.on_button('my_button')
async def handler():
    await bridge.log("Button clicked!")
```

---

### Drawing Commands

All drawing commands are `async` and return a `drawing_id` string that can be used to remove the drawing later.

#### `draw_marker(time, price, *, shape, color, text, position)`
Draw an arrow, dot, or label at a specific candle.

| Param | Type | Default | Options |
|---|---|---|---|
| `time` | `int` | required | Unix timestamp |
| `price` | `float` | required | Price level |
| `shape` | `str` | `'arrowUp'` | `arrowUp`, `arrowDown`, `circle`, `square` |
| `color` | `str` | `'#2962ff'` | Hex color |
| `text` | `str` | `''` | Label text |
| `position` | `str` | `'belowBar'` | `belowBar`, `aboveBar`, `inBar` |

```python
await bridge.draw_marker(candle['time'], candle['low'],
                          shape='arrowUp', color='#26a69a', text='BUY')
```

#### `draw_box(start_time, end_time, top, bottom, *, color, border_color, label)`
Draw a rectangle — **perfect for order blocks, supply/demand zones**.

| Param | Type | Default |
|---|---|---|
| `start_time` | `int` | required |
| `end_time` | `int` | required |
| `top` | `float` | required |
| `bottom` | `float` | required |
| `color` | `str` | `'rgba(41,98,255,0.15)'` |
| `border_color` | `str` | `'#2962ff'` |
| `label` | `str` | `''` |

```python
await bridge.draw_box(
    start_time=ob_start, end_time=ob_end,
    top=zone_high, bottom=zone_low,
    color='rgba(38,166,154,0.12)', border_color='#26a69a',
    label='Bullish OB'
)
```

#### `draw_line(time1, price1, time2, price2, *, color, width, style, label)`
Draw a line between two points (trend lines, support/resistance).

| Param | Type | Default | Options |
|---|---|---|---|
| `style` | `int` | `0` | `0`=solid, `1`=dotted, `2`=dashed |
| `width` | `int` | `1` | 1–4 |

```python
await bridge.draw_line(t1, high1, t2, high2, color='#ff9800', style=2, label='Resistance')
```

#### `draw_hline(price, *, color, width, style, label)`
Draw a horizontal line across the entire chart.

```python
await bridge.draw_hline(42000.0, color='#2962ff', label='Key Level')
```

#### `draw_text(time, price, text, *, color)`
Place a text annotation at a specific point.

```python
await bridge.draw_text(candle['time'], candle['high'], 'Divergence', color='#ff9800')
```

#### `highlight_candle(time, *, color)`
Highlight a specific candle.

```python
await bridge.highlight_candle(candle['time'], color='rgba(255,235,59,0.5)')
```

#### `remove_drawing(drawing_id)`
Remove a specific drawing by its ID.

```python
marker_id = await bridge.draw_marker(...)
# Later:
await bridge.remove_drawing(marker_id)
```

#### `clear_drawings()`
Remove **all** custom drawings from the chart.

```python
await bridge.clear_drawings()
```

---

### Trading Commands

#### `place_trade(side, lots, leverage, tp, sl, symbol) → dict`
Place a simulated trade at the current replay price.

```python
result = await bridge.place_trade(
    side='buy', lots=0.1, leverage=10,
    tp=44000.0, sl=41000.0, symbol='BTCUSDT'
)
# result = {'position_id': 1, 'entry_price': 42500.0}
```

#### `close_trade(position_id)`
Close a specific position.

```python
await bridge.close_trade(position_id=1)
```

#### `close_all()`
Close all open positions.

#### `modify_trade(position_id, *, tp, sl)`
Update TP/SL of an existing position.

```python
await bridge.modify_trade(position_id=1, tp=45000.0, sl=40000.0)
```

---

### Data Queries

All queries are `async` and return data from the chart.

#### `get_candles() → list[dict]`
Get all visible candles up to the current replay point.

```python
candles = await bridge.get_candles()
# [{time, open, high, low, close, volume}, ...]
```

#### `get_indicator(name, period, **kwargs) → list`
Get indicator values computed from chart data.

| Name | Params | Returns |
|---|---|---|
| `'sma'` | `period` | `[{time, value}, ...]` |
| `'ema'` | `period` | `[{time, value}, ...]` |
| `'rsi'` | `period` | `[{time, value}, ...]` |
| `'bb'` | `period`, `mult` | `{upper, middle, lower}` |
| `'macd'` | `fast`, `slow`, `signal` | `{macdLine, signalLine, histogram}` |

```python
ema_data = await bridge.get_indicator('ema', period=20)
bb_data = await bridge.get_indicator('bb', period=20, mult=2)
```

#### `get_current_price() → float`
Get the current candle's close price.

#### `get_account() → dict`
Get account info.

```python
account = await bridge.get_account()
# {balance, equity, unrealized_pnl, total_trades, win_rate}
```

#### `get_positions() → list[dict]`
Get all open positions.

```python
positions = await bridge.get_positions()
# [{id, side, lots, leverage, entry_price, tp, sl, pnl, symbol}, ...]
```

#### `get_trade_history() → list[dict]`
Get all closed trades with entry/exit prices and EMA snapshots.

#### `get_replay_state() → dict`
Get current replay state.

```python
state = await bridge.get_replay_state()
# {is_playing, index, total, speed, timeframe}
```

---

### UI Commands

#### `notify(message, level, duration)`
Show a message in the status bar.

| Param | Options |
|---|---|
| `level` | `'success'`, `'error'`, `''` (neutral) |
| `duration` | Milliseconds. `0` = permanent |

```python
await bridge.notify("🟢 Model loaded successfully!", level='success', duration=3000)
```

#### `log(message)`
Log to the bridge panel console (visible when user clicks 🧩 Bridge).

```python
await bridge.log(f"Prediction: {confidence:.2%} confidence")
```

#### `add_button(label, button_id, color)`
Add a custom button to the bridge panel.

```python
await bridge.add_button("🔍 Scan Order Blocks", "scan_ob", color="#2962ff")
```

#### `set_panel_html(html)`
Set custom HTML in the bridge panel for advanced UIs.

```python
await bridge.set_panel_html('<div style="color:#26a69a">Model: Active</div>')
```

---

## Examples

### 📁 `sdk/example_sma_crossover.py`
Simple SMA(9/21) crossover strategy. Draws buy/sell arrows and auto-places trades at crossover points. Great starting template.

### 📁 `sdk/example_orderblock.py`
Order block detector with a custom "Scan" button. Demonstrates on-demand model execution (vs. per-candle), box drawing for zones, and data queries.

---

## Integrating Your ML Model

### XGBoost / scikit-learn

```python
import joblib
from sdk.localbarreplay import Bridge
import numpy as np

bridge = Bridge()
model = joblib.load('my_xgboost_model.pkl')

@bridge.on_candle
async def predict(candle, history):
    if len(history) < 50:
        return

    # Extract features your model was trained on
    closes = [c['close'] for c in history[-50:]]
    features = np.array([
        closes[-1] / closes[-20] - 1,  # 20-period return
        max(closes[-14:]) / min(closes[-14:]) - 1,  # 14-period range
        # ... your features here
    ]).reshape(1, -1)

    prediction = model.predict(features)[0]
    probability = model.predict_proba(features)[0][1]

    if prediction == 1 and probability > 0.7:
        await bridge.draw_marker(candle['time'], candle['low'],
                                  shape='arrowUp', color='#26a69a',
                                  text=f'{probability:.0%}')
        await bridge.place_trade(side='buy', lots=0.1)

bridge.run()
```

### TensorFlow / Keras

```python
import tensorflow as tf
from sdk.localbarreplay import Bridge

bridge = Bridge()
model = tf.keras.models.load_model('my_lstm_model.h5')

@bridge.on_candle
async def predict(candle, history):
    if len(history) < 60:
        return

    # Prepare sequence for LSTM
    sequence = [[c['open'], c['high'], c['low'], c['close'], c['volume']]
                for c in history[-60:]]
    X = tf.constant([sequence])

    pred = model.predict(X, verbose=0)[0]
    if pred[0] > 0.6:  # bullish
        await bridge.draw_marker(candle['time'], candle['low'],
                                  shape='arrowUp', color='#26a69a', text='LSTM↑')
    elif pred[0] < 0.4:  # bearish
        await bridge.draw_marker(candle['time'], candle['high'],
                                  shape='arrowDown', color='#ef5350', text='LSTM↓',
                                  position='aboveBar')

bridge.run()
```

### ONNX Runtime (for sklearn/XGBoost exported as ONNX)

```python
import onnxruntime as ort
from sdk.localbarreplay import Bridge

bridge = Bridge()
session = ort.InferenceSession('model.onnx')

@bridge.on_candle
async def predict(candle, history):
    features = extract_features(history)  # your feature engineering
    input_name = session.get_inputs()[0].name
    result = session.run(None, {input_name: features})
    # ... use result to draw/trade

bridge.run()
```

---

## How It Works (Technical Details)

1. **Your Python script** starts a WebSocket server on `ws://localhost:9876`
2. **The chart** (index.html) has a tiny WebSocket client that tries to connect on page load
3. If nothing's running → **silently fails**, chart works normally
4. If bridge is running → **auto-connects**, 🧩 icon appears, events start flowing
5. Communication is **bidirectional JSON messages** over WebSocket
6. All drawing/trading commands are **async** for non-blocking execution

### Message Protocol

Every message is a JSON object with a `type` field:

```json
// Python → Chart (command)
{"type": "draw_marker", "time": 1714000000, "price": 42500, "shape": "arrowUp", "color": "#26a69a", "text": "BUY", "request_id": "abc123"}

// Chart → Python (response)
{"type": "response", "request_id": "abc123", "data": {"drawing_id": "m_1"}}

// Chart → Python (event)
{"type": "event", "event": "candle", "data": {"time": 1714000000, "open": 42500, "high": 42600, "low": 42400, "close": 42550, "volume": 100}}
```

---

## FAQ

**Q: Do I need to run a server to use LocalBarReplay?**
No. Just open `index.html`. The bridge is only needed if you want to connect ML models.

**Q: Can I use non-Python languages?**
Yes! The bridge uses standard WebSocket + JSON. You can connect from any language (Node.js, Rust, Go, etc.) — just implement the same message protocol.

**Q: What happens if my Python script crashes?**
The chart continues working normally. Drawings from the crashed session remain on the chart. When you restart the script, it auto-reconnects.

**Q: Can I run multiple models simultaneously?**
The current bridge supports one connection at a time. For multiple models, combine them in a single Python script.

**Q: How fast is the bridge?**
WebSocket latency is typically <1ms on localhost. The bottleneck is usually your model's inference time, not the bridge.

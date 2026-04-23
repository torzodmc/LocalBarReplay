"""
Example: Simple Moving Average Crossover Strategy
==================================================
Draws markers on the chart when SMA(9) crosses above/below SMA(21).
Auto-places trades at crossover points.

Usage:
    pip install websockets
    python example_sma_crossover.py
    Then open index.html in your browser.
"""

from localbarreplay import Bridge

bridge = Bridge()

# Simple SMA calculation
def calc_sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period

@bridge.on_candle
async def on_candle(candle, history):
    if len(history) < 25:
        return

    closes = [c['close'] for c in history]
    fast = calc_sma(closes, 9)
    slow = calc_sma(closes, 21)

    if fast is None or slow is None:
        return

    # Check previous values for crossover
    prev_closes = closes[:-1]
    prev_fast = calc_sma(prev_closes, 9)
    prev_slow = calc_sma(prev_closes, 21)

    if prev_fast is None or prev_slow is None:
        return

    # Bullish crossover: fast crosses above slow
    if prev_fast <= prev_slow and fast > slow:
        await bridge.draw_marker(
            candle['time'], candle['low'],
            shape='arrowUp', color='#26a69a', text='BUY',
            position='belowBar'
        )
        await bridge.place_trade(side='buy', lots=0.1, leverage=10)
        await bridge.log(f"🟢 BUY signal at {candle['close']:.2f}")

    # Bearish crossover: fast crosses below slow
    elif prev_fast >= prev_slow and fast < slow:
        await bridge.draw_marker(
            candle['time'], candle['high'],
            shape='arrowDown', color='#ef5350', text='SELL',
            position='aboveBar'
        )
        await bridge.close_all()
        await bridge.log(f"🔴 SELL signal at {candle['close']:.2f}")

if __name__ == '__main__':
    bridge.run()

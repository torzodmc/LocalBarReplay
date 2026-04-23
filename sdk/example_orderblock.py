"""
Example: Order Block Detector with Custom Button
=================================================
Demonstrates a model that runs on-demand via a button click,
scans history for order blocks, and draws them as boxes on the chart.

Usage:
    pip install websockets
    python example_orderblock.py
    Then open index.html in your browser.
"""

from localbarreplay import Bridge

bridge = Bridge()


def detect_order_blocks(candles, min_move_pct=0.5):
    """
    Simple order block detection logic.
    An order block is a consolidation candle before a strong move.
    Replace this with your own ML model's predict() call.
    """
    blocks = []
    if len(candles) < 5:
        return blocks

    for i in range(2, len(candles) - 2):
        c = candles[i]
        body = abs(c['close'] - c['open'])
        wick = c['high'] - c['low']

        # Small body candle (consolidation)
        if wick == 0:
            continue
        body_ratio = body / wick

        if body_ratio > 0.4:
            continue

        # Check for strong move after
        next_c = candles[i + 1]
        move = abs(next_c['close'] - c['close']) / c['close'] * 100

        if move < min_move_pct:
            continue

        # Determine direction
        is_bullish = next_c['close'] > c['close']

        blocks.append({
            'start_time': c['time'],
            'end_time': next_c['time'],
            'high': c['high'],
            'low': c['low'],
            'type': 'bullish' if is_bullish else 'bearish',
        })

    return blocks


@bridge.on_button('scan_ob')
async def run_scan():
    """Called when user clicks 'Scan Order Blocks' button."""
    await bridge.log("Scanning for order blocks...")
    await bridge.clear_drawings()

    candles = await bridge.get_candles()
    if not candles:
        await bridge.notify("No candle data available", level='error')
        return

    blocks = detect_order_blocks(candles)
    await bridge.log(f"Found {len(blocks)} order blocks")

    for ob in blocks:
        color = 'rgba(38,166,154,0.12)' if ob['type'] == 'bullish' else 'rgba(239,83,80,0.12)'
        border = '#26a69a' if ob['type'] == 'bullish' else '#ef5350'

        await bridge.draw_box(
            start_time=ob['start_time'],
            end_time=ob['end_time'],
            top=ob['high'],
            bottom=ob['low'],
            color=color,
            border_color=border,
            label=f"{'Bull' if ob['type'] == 'bullish' else 'Bear'} OB"
        )

    await bridge.notify(f"Found {len(blocks)} order blocks", duration=3000)

    # Also show account stats
    account = await bridge.get_account()
    await bridge.log(f"Account balance: ${account.get('balance', 0):.2f}")


async def setup():
    """Runs once when chart connects — add our custom button."""
    await bridge.add_button("🔍 Scan Order Blocks", "scan_ob", color="#2962ff")
    await bridge.log("Order Block Detector ready. Click the button to scan.")

# We use on_candle just to trigger setup once
_setup_done = False

@bridge.on_candle
async def on_first_candle(candle, history):
    global _setup_done
    if not _setup_done:
        _setup_done = True
        await setup()


if __name__ == '__main__':
    bridge.run()

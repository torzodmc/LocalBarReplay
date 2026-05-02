"""
MT5 → LocalBarReplay Auto-Fetcher
===================================
Fetches historical OHLCV data from MetaTrader 5 and loads it
directly into the LocalBarReplay chart — no CSV export needed.

Requirements:
    pip install MetaTrader5 websockets

Usage:
    python mt5_fetch.py
    python mt5_fetch.py --symbol EURUSD --tf H1 --days 90
    python mt5_fetch.py --symbol USDJPY --tf M15 --days 30

Then open index.html in your browser. Data will load automatically.
"""

import asyncio
import argparse
import sys
from datetime import datetime, timedelta, timezone

# ── Check dependencies ──────────────────────────────────────────────────────
try:
    import MetaTrader5 as mt5
except ImportError:
    print("❌  MetaTrader5 not installed. Run:  pip install MetaTrader5")
    sys.exit(1)

try:
    import websockets  # noqa — imported inside SDK
except ImportError:
    print("❌  websockets not installed. Run:  pip install websockets")
    sys.exit(1)

# Add SDK to path (script lives in sdk/ folder)
import os
sys.path.insert(0, os.path.dirname(__file__))
from localbarreplay import Bridge

# ── Timeframe map: string → (MT5 constant, minutes) ──────────────────────
TF_MAP = {
    'M1':   (mt5.TIMEFRAME_M1,   1),
    'M5':   (mt5.TIMEFRAME_M5,   5),
    'M15':  (mt5.TIMEFRAME_M15,  15),
    'M30':  (mt5.TIMEFRAME_M30,  30),
    'H1':   (mt5.TIMEFRAME_H1,   60),
    'H2':   (mt5.TIMEFRAME_H2,   120),
    'H4':   (mt5.TIMEFRAME_H4,   240),
    'H6':   (mt5.TIMEFRAME_H6,   360),
    'H12':  (mt5.TIMEFRAME_H12,  720),
    'D1':   (mt5.TIMEFRAME_D1,   1440),
}


def fetch_mt5_candles(symbol: str, tf_str: str, days: int) -> list[dict]:
    """Connect to MT5 and pull historical OHLCV bars."""
    print(f"🔌  Connecting to MetaTrader 5…")
    if not mt5.initialize():
        raise RuntimeError(f"MT5 initialize() failed: {mt5.last_error()}")

    info = mt5.terminal_info()
    print(f"✅  MT5 connected: {info.name} (build {info.build})")

    if tf_str not in TF_MAP:
        mt5.shutdown()
        raise ValueError(f"Unknown timeframe '{tf_str}'. Choose: {', '.join(TF_MAP)}")

    mt5_tf, tf_minutes = TF_MAP[tf_str]

    # Date range
    date_to   = datetime.now(timezone.utc)
    date_from = date_to - timedelta(days=days)

    print(f"📥  Fetching {symbol} {tf_str} from {date_from.date()} to {date_to.date()}…")
    rates = mt5.copy_rates_range(symbol, mt5_tf, date_from, date_to)
    mt5.shutdown()

    if rates is None or len(rates) == 0:
        raise RuntimeError(
            f"No data returned for {symbol}. "
            f"Make sure the symbol is available in your broker's Market Watch."
        )

    # Convert numpy structured array → list of plain dicts
    candles = [
        {
            'time':   int(r['time']),    # unix seconds
            'open':   float(r['open']),
            'high':   float(r['high']),
            'low':    float(r['low']),
            'close':  float(r['close']),
            'volume': float(r['real_volume'] if r['real_volume'] > 0 else r['tick_volume']),
        }
        for r in rates
    ]

    print(f"✅  {len(candles)} bars fetched.")
    return candles, tf_minutes


async def main(symbol: str, tf_str: str, days: int):
    candles, tf_minutes = fetch_mt5_candles(symbol, tf_str, days)

    # Determine asset type from symbol name
    forex_pairs = {'EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'USDCAD',
                   'USDCHF', 'NZDUSD', 'EURJPY', 'GBPJPY', 'EURGBP',
                   'AUDJPY', 'EURAUD', 'XAUUSD', 'XAGUSD'}
    asset_type = 'forex' if symbol.upper() in forex_pairs or len(symbol) == 6 else 'crypto'

    bridge = Bridge()

    @bridge.on_button('reload')
    async def handle_reload():
        """Re-fetch when user clicks Reload button in the bridge panel."""
        await bridge.notify(f"♻️ Re-fetching {symbol} from MT5…", level='', duration=2000)
        try:
            new_candles, _ = fetch_mt5_candles(symbol, tf_str, days)
            result = await bridge.load_data(new_candles, symbol=symbol,
                                             asset_type=asset_type, timeframe=tf_minutes)
            await bridge.notify(f"✅ Reloaded {symbol}: {result.get('candles', 0)} bars", duration=3000)
        except Exception as e:
            await bridge.notify(f"❌ Reload failed: {e}", level='error', duration=5000)

    # Auto-load on connect
    async def on_connected():
        await asyncio.sleep(0.5)  # give chart a moment to init

        await bridge.notify(f"📥 Loading {symbol} {tf_str} ({len(candles)} bars)…",
                            level='', duration=2000)

        result = await bridge.load_data(
            candles,
            symbol=symbol,
            asset_type=asset_type,
            timeframe=tf_minutes,
        )

        if result.get('ok'):
            await bridge.notify(
                f"✅ {symbol} {tf_str} loaded — {result['candles']} bars",
                level='success', duration=4000
            )
        else:
            await bridge.notify(
                f"❌ Load failed: {result.get('error', 'unknown')}",
                level='error', duration=0
            )

        await bridge.add_button(f"♻️ Reload {symbol}", 'reload')
        await bridge.log(f"Loaded {symbol} {tf_str} — {len(candles)} bars ({days} days)")

    # Patch the bridge handler to call on_connected after handshake
    _orig_handler = bridge._handler
    async def _patched_handler(ws):
        bridge._ws = ws
        bridge._connected.set()
        print("✅ Chart connected!")

        # Subscribe to events we have handlers for
        if bridge._button_handlers:
            pass  # buttons are added after connection via add_button
        await on_connected()

        try:
            async for raw in ws:
                try:
                    import json
                    msg = json.loads(raw)
                    await bridge._on_message(msg)
                except Exception:
                    pass
        except websockets.ConnectionClosed:
            print("⚠️  Chart disconnected")
            bridge._ws = None
            bridge._connected.clear()

    bridge._handler = _patched_handler
    bridge.run()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Fetch MT5 Forex data and load into LocalBarReplay',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python mt5_fetch.py
  python mt5_fetch.py --symbol EURUSD --tf H1 --days 90
  python mt5_fetch.py --symbol USDJPY --tf M15 --days 30
  python mt5_fetch.py --symbol GBPUSD --tf D1 --days 365
        """
    )
    parser.add_argument('--symbol', default='EURUSD',
                        help='MT5 symbol name (default: EURUSD)')
    parser.add_argument('--tf', default='H1',
                        choices=list(TF_MAP.keys()),
                        help='Timeframe (default: H1)')
    parser.add_argument('--days', type=int, default=90,
                        help='How many days back to fetch (default: 90)')
    args = parser.parse_args()

    try:
        asyncio.run(main(args.symbol, args.tf, args.days))
    except KeyboardInterrupt:
        print("\n👋  Stopped.")

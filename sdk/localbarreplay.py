"""
LocalBarReplay — Python Bridge SDK
===================================
Connect your ML models, trading strategies, and analysis tools
to LocalBarReplay's chart via WebSocket.

Requirements:  pip install websockets

Usage:
    from localbarreplay import Bridge

    bridge = Bridge()

    @bridge.on_candle
    def handle(candle, history):
        if candle['close'] > candle['open']:
            bridge.draw_marker(candle['time'], candle['low'], shape='arrowUp', color='#26a69a', text='Bull')

    bridge.run()
"""

import asyncio
import json
import uuid
import websockets
import threading
from typing import Callable, Optional, Dict, Any, List

__version__ = "1.0.0"


class Bridge:
    """
    WebSocket bridge between Python ML models and LocalBarReplay chart.

    The bridge runs a WebSocket server on localhost:9876 that the chart
    connects to automatically. All communication is JSON over WebSocket.
    """

    def __init__(self, port: int = 9876):
        self.port = port
        self._ws = None
        self._loop = None
        self._candle_handler = None
        self._trade_open_handler = None
        self._trade_close_handler = None
        self._replay_state_handler = None
        self._timeframe_handler = None
        self._button_handlers: Dict[str, Callable] = {}
        self._pending: Dict[str, asyncio.Future] = {}
        self._candle_history: List[dict] = []
        self._connected = asyncio.Event()

    # ═══════════════════════════════════════════════════════
    # EVENT DECORATORS
    # ═══════════════════════════════════════════════════════

    def on_candle(self, fn: Callable):
        """Decorator. Called on every new candle during replay.
        
        @bridge.on_candle
        def handler(candle: dict, history: list[dict]):
            # candle = {time, open, high, low, close, volume}
            # history = all candles up to current point
            pass
        """
        self._candle_handler = fn
        return fn

    def on_trade_open(self, fn: Callable):
        """Decorator. Called when a trade is opened (by user or by bridge)."""
        self._trade_open_handler = fn
        return fn

    def on_trade_close(self, fn: Callable):
        """Decorator. Called when a trade is closed."""
        self._trade_close_handler = fn
        return fn

    def on_replay_state(self, fn: Callable):
        """Decorator. Called when replay play/pause/stop state changes."""
        self._replay_state_handler = fn
        return fn

    def on_timeframe_change(self, fn: Callable):
        """Decorator. Called when user switches timeframe."""
        self._timeframe_handler = fn
        return fn

    def on_button(self, button_id: str):
        """Decorator. Called when a custom button is clicked.

        @bridge.on_button('run_scan')
        def handle_click():
            pass
        """
        def decorator(fn: Callable):
            self._button_handlers[button_id] = fn
            return fn
        return decorator

    # ═══════════════════════════════════════════════════════
    # DRAWING COMMANDS
    # ═══════════════════════════════════════════════════════

    async def draw_marker(self, time: int, price: float, *,
                          shape: str = 'arrowUp', color: str = '#2962ff',
                          text: str = '', position: str = 'belowBar',
                          id: str = None) -> str:
        """Draw a marker (arrow, dot, label) on the chart.

        Args:
            time: Unix timestamp of the candle
            price: Price level (used for positioning reference)
            shape: 'arrowUp', 'arrowDown', 'circle', 'square'
            color: Hex color string
            text: Label text
            position: 'aboveBar', 'belowBar', 'inBar'
            id: Optional custom ID. Auto-generated if not provided.

        Returns:
            drawing_id: unique identifier for this drawing
        """
        resp = await self._request('draw_marker', time=time, price=price,
                                    shape=shape, color=color, text=text,
                                    position=position, id=id)
        return resp.get('drawing_id', '')

    async def draw_box(self, start_time: int, end_time: int,
                       top: float, bottom: float, *,
                       color: str = 'rgba(41,98,255,0.15)',
                       border_color: str = '#2962ff',
                       label: str = '', id: str = None) -> str:
        """Draw a box/rectangle on the chart (perfect for order blocks).

        Args:
            start_time: Start unix timestamp
            end_time: End unix timestamp
            top: Upper price boundary
            bottom: Lower price boundary
            color: Fill color (use rgba for transparency)
            border_color: Border line color
            label: Text label
        """
        resp = await self._request('draw_box', start_time=start_time,
                                    end_time=end_time, top=top, bottom=bottom,
                                    color=color, border_color=border_color,
                                    label=label, id=id)
        return resp.get('drawing_id', '')

    async def draw_line(self, time1: int, price1: float,
                        time2: int, price2: float, *,
                        color: str = '#ff9800', width: int = 1,
                        style: int = 0, label: str = '',
                        id: str = None) -> str:
        """Draw a line between two points on the chart.

        Args:
            time1, price1: Start point
            time2, price2: End point
            color: Line color
            width: Line width (1-4)
            style: 0=solid, 1=dotted, 2=dashed, 3=large-dashed
            label: Text label
        """
        resp = await self._request('draw_line', time1=time1, price1=price1,
                                    time2=time2, price2=price2,
                                    color=color, width=width, style=style,
                                    label=label, id=id)
        return resp.get('drawing_id', '')

    async def draw_hline(self, price: float, *,
                         color: str = '#ff9800', width: int = 1,
                         style: int = 2, label: str = '',
                         id: str = None) -> str:
        """Draw a horizontal price line across the entire chart.

        Args:
            price: Price level
            color: Line color
            style: 0=solid, 1=dotted, 2=dashed
            label: Label text shown on price axis
        """
        resp = await self._request('draw_hline', price=price, color=color,
                                    width=width, style=style, label=label, id=id)
        return resp.get('drawing_id', '')

    async def draw_text(self, time: int, price: float, text: str, *,
                        color: str = '#d1d4dc', id: str = None) -> str:
        """Place a text annotation on the chart."""
        resp = await self._request('draw_text', time=time, price=price,
                                    text=text, color=color, id=id)
        return resp.get('drawing_id', '')

    async def highlight_candle(self, time: int, *,
                               color: str = 'rgba(255,235,59,0.5)',
                               id: str = None) -> str:
        """Highlight a specific candle with a colored marker."""
        resp = await self._request('highlight_candle', time=time,
                                    color=color, id=id)
        return resp.get('drawing_id', '')

    async def remove_drawing(self, drawing_id: str):
        """Remove a specific drawing by its ID."""
        await self._send_cmd('remove_drawing', drawing_id=drawing_id)

    async def clear_drawings(self):
        """Remove all custom drawings from the chart."""
        await self._send_cmd('clear_drawings')

    # ═══════════════════════════════════════════════════════
    # TRADING COMMANDS
    # ═══════════════════════════════════════════════════════

    async def place_trade(self, side: str = 'buy', lots: float = 0.1,
                          leverage: int = 10, tp: float = None,
                          sl: float = None, symbol: str = '') -> dict:
        """Place a simulated trade.

        Args:
            side: 'buy' or 'sell'
            lots: Position size
            leverage: Leverage multiplier
            tp: Take profit price (optional)
            sl: Stop loss price (optional)
            symbol: Trading symbol

        Returns:
            dict with 'position_id' and 'entry_price'
        """
        return await self._request('place_trade', side=side, lots=lots,
                                    leverage=leverage, tp=tp, sl=sl, symbol=symbol)

    async def close_trade(self, position_id: int):
        """Close a specific position by ID."""
        await self._send_cmd('close_trade', position_id=position_id)

    async def close_all(self):
        """Close all open positions."""
        await self._send_cmd('close_all')

    async def modify_trade(self, position_id: int, *,
                           tp: float = None, sl: float = None):
        """Modify TP/SL of an existing position."""
        await self._send_cmd('modify_trade', position_id=position_id,
                             tp=tp, sl=sl)

    # ═══════════════════════════════════════════════════════
    # DATA QUERIES
    # ═══════════════════════════════════════════════════════

    async def get_candles(self) -> List[dict]:
        """Get all visible candles up to current replay point.

        Returns:
            List of {time, open, high, low, close, volume}
        """
        resp = await self._request('get_candles')
        return resp.get('candles', [])

    async def get_indicator(self, name: str, period: int = 14, **kwargs) -> Any:
        """Get indicator values from the chart.

        Args:
            name: 'sma', 'ema', 'rsi', 'bb', 'macd'
            period: Indicator period
            **kwargs: Additional params (mult for BB, fast/slow/signal for MACD)

        Returns:
            Indicator data array or dict
        """
        resp = await self._request('get_indicator', name=name, period=period, **kwargs)
        return resp.get('data', [])

    async def get_current_price(self) -> float:
        """Get the current candle's close price."""
        resp = await self._request('get_current_price')
        return resp.get('price', 0)

    async def get_account(self) -> dict:
        """Get account info: balance, equity, unrealized_pnl, total_trades, win_rate."""
        return await self._request('get_account')

    async def get_positions(self) -> List[dict]:
        """Get all open positions."""
        resp = await self._request('get_positions')
        return resp.get('positions', [])

    async def get_trade_history(self) -> List[dict]:
        """Get all closed trade history with EMA snapshots."""
        resp = await self._request('get_trade_history')
        return resp.get('trades', [])

    async def get_replay_state(self) -> dict:
        """Get replay state: is_playing, index, total, speed, timeframe."""
        return await self._request('get_replay_state')

    # ═══════════════════════════════════════════════════════
    # UI COMMANDS
    # ═══════════════════════════════════════════════════════

    async def notify(self, message: str, level: str = 'success', duration: int = 5000):
        """Show a notification in the chart's status bar.

        Args:
            message: Text to display
            level: 'success', 'error', or '' (neutral)
            duration: Ms to show (0 = permanent)
        """
        await self._send_cmd('notify', message=message, level=level, duration=duration)

    async def log(self, message: str):
        """Log a message to the bridge panel console."""
        await self._send_cmd('log', message=message)

    async def add_button(self, label: str, button_id: str, color: str = None):
        """Add a custom button to the bridge panel.

        Use @bridge.on_button(button_id) to handle clicks.
        """
        await self._send_cmd('add_button', label=label, button_id=button_id, color=color)

    async def set_panel_html(self, html: str):
        """Set custom HTML content in the bridge panel."""
        await self._send_cmd('set_panel_html', html=html)

    # ═══════════════════════════════════════════════════════
    # RUN / INTERNALS
    # ═══════════════════════════════════════════════════════

    def run(self):
        """Start the bridge server (blocking). Opens ws://localhost:{port}."""
        print(f"🧩 LocalBarReplay Bridge v{__version__}")
        print(f"   WebSocket server on ws://localhost:{self.port}")
        print(f"   Open index.html in your browser — it will auto-connect.")
        print(f"   Press Ctrl+C to stop.\n")
        asyncio.run(self._serve())

    async def _serve(self):
        async with websockets.serve(self._handler, "localhost", self.port):
            await asyncio.Future()  # run forever

    async def _handler(self, ws):
        self._ws = ws
        self._connected.set()
        print("✅ Chart connected!")

        # Subscribe to events we have handlers for
        if self._candle_handler:
            await self._send_cmd('subscribe', event='candle')
        if self._trade_open_handler:
            await self._send_cmd('subscribe', event='trade_open')
        if self._trade_close_handler:
            await self._send_cmd('subscribe', event='trade_close')
        if self._replay_state_handler:
            await self._send_cmd('subscribe', event='replay_state')
        if self._timeframe_handler:
            await self._send_cmd('subscribe', event='timeframe_change')

        # Notify chart
        await self.notify("🧩 Python bridge connected!", duration=3000)

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    await self._on_message(msg)
                except json.JSONDecodeError:
                    pass
        except websockets.ConnectionClosed:
            print("⚠️  Chart disconnected")
            self._ws = None
            self._connected.clear()

    async def _on_message(self, msg):
        msg_type = msg.get('type')

        if msg_type == 'handshake':
            print(f"   App: {msg.get('app')} v{msg.get('version')}")
            return

        if msg_type == 'response':
            rid = msg.get('request_id')
            if rid and rid in self._pending:
                self._pending[rid].set_result(msg.get('data', {}))
            return

        if msg_type == 'event':
            event = msg.get('event')
            data = msg.get('data', {})

            if event == 'candle' and self._candle_handler:
                self._candle_history.append(data)
                try:
                    result = self._candle_handler(data, list(self._candle_history))
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    print(f"❌ on_candle error: {e}")

            elif event == 'trade_open' and self._trade_open_handler:
                try:
                    result = self._trade_open_handler(data)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    print(f"❌ on_trade_open error: {e}")

            elif event == 'trade_close' and self._trade_close_handler:
                try:
                    result = self._trade_close_handler(data)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    print(f"❌ on_trade_close error: {e}")

            elif event == 'replay_state' and self._replay_state_handler:
                try:
                    result = self._replay_state_handler(data)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    print(f"❌ on_replay_state error: {e}")

            elif event == 'timeframe_change' and self._timeframe_handler:
                try:
                    result = self._timeframe_handler(data)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    print(f"❌ on_timeframe_change error: {e}")

            elif event == 'button_click':
                btn_id = msg.get('button_id')
                if btn_id in self._button_handlers:
                    try:
                        result = self._button_handlers[btn_id]()
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        print(f"❌ Button '{btn_id}' error: {e}")

    async def _send_cmd(self, cmd_type: str, **kwargs):
        if not self._ws:
            return
        msg = {'type': cmd_type, **kwargs}
        await self._ws.send(json.dumps(msg))

    async def _request(self, cmd_type: str, **kwargs) -> dict:
        if not self._ws:
            return {}
        rid = str(uuid.uuid4())[:8]
        future = asyncio.get_event_loop().create_future()
        self._pending[rid] = future
        msg = {'type': cmd_type, 'request_id': rid, **kwargs}
        await self._ws.send(json.dumps(msg))
        try:
            return await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            return {}

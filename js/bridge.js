/* ═══════════════ WebSocket Bridge — ML Model Integration ═══════════════ */
/*
 * Connects to a local Python bridge via WebSocket (ws://localhost:9876).
 * If no server is running, silently fails — chart works normally.
 * When connected, receives JSON commands to draw on chart, place trades, etc.
 * Sends candle data and events back to the Python script.
 */

const BridgeClient = {
    ws: null,
    connected: false,
    reconnectTimer: null,
    drawings: [],      // { id, type, seriesRef/lineRef }
    customButtons: [],
    _nextDrawingId: 1,
    _pendingRequests: {},  // requestId → resolve callback
    _eventSubscriptions: {}, // event → true (what the Python side subscribed to)

    PORT: 9876,
    RECONNECT_INTERVAL: 5000,

    // ── Custom drawing series for markers, boxes, lines ──
    _markerData: [],   // lightweight-charts markers
    _customLineSeries: [], // for box/line drawings
    _hLines: [],       // horizontal price lines

    init() {
        this.connect();
    },

    connect() {
        try {
            this.ws = new WebSocket(`ws://localhost:${this.PORT}`);
        } catch (e) { return; }

        this.ws.onopen = () => {
            this.connected = true;
            this._showBridgeIcon(true);
            console.log('[Bridge] Connected to Python bridge');
            // Send initial handshake
            this._send({ type: 'handshake', version: '1.0', app: 'LocalBarReplay' });
            if (this.reconnectTimer) { clearInterval(this.reconnectTimer); this.reconnectTimer = null; }
        };

        this.ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                this._handleMessage(msg);
            } catch (e) { console.warn('[Bridge] Invalid message:', e); }
        };

        this.ws.onclose = () => {
            this.connected = false;
            this._showBridgeIcon(false);
            // Auto-reconnect
            if (!this.reconnectTimer) {
                this.reconnectTimer = setInterval(() => this.connect(), this.RECONNECT_INTERVAL);
            }
        };

        this.ws.onerror = () => {
            // Silently fail — no bridge running is fine
        };
    },

    _send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    },

    // ── Show/hide bridge icon in header ──
    _showBridgeIcon(show) {
        let icon = document.getElementById('bridge-icon');
        if (show) {
            if (!icon) {
                icon = document.createElement('button');
                icon.id = 'bridge-icon';
                icon.className = 'btn-secondary bridge-btn';
                icon.innerHTML = '🧩 Bridge';
                icon.title = 'ML Bridge Connected';
                icon.addEventListener('click', () => this._togglePanel());
                const header = document.getElementById('asset-panel');
                if (header) header.appendChild(icon);
            }
            icon.classList.remove('hidden');
            icon.classList.add('bridge-active');
        } else {
            if (icon) icon.classList.add('hidden');
        }
    },

    _togglePanel() {
        let panel = document.getElementById('bridge-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'bridge-panel';
            panel.className = 'bridge-panel';
            panel.innerHTML = `
        <div class="bridge-panel-header">
          <span>🧩 ML Bridge</span>
          <span class="bridge-status">● Connected</span>
        </div>
        <div id="bridge-log" class="bridge-log"></div>
        <div id="bridge-buttons" class="bridge-buttons"></div>
        <div id="bridge-custom-panel"></div>
      `;
            document.getElementById('chart-area').appendChild(panel);
        }
        panel.classList.toggle('hidden');
    },

    _log(msg) {
        const logEl = document.getElementById('bridge-log');
        if (!logEl) return;
        const line = document.createElement('div');
        line.className = 'bridge-log-line';
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        // Keep max 100 lines
        while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
    },

    // ═══════════ HANDLE INCOMING COMMANDS ═══════════

    _handleMessage(msg) {
        const { type, request_id } = msg;

        switch (type) {
            // ── Drawing Commands ──
            case 'draw_marker': this._drawMarker(msg); break;
            case 'draw_box': this._drawBox(msg); break;
            case 'draw_line': this._drawLine(msg); break;
            case 'draw_hline': this._drawHLine(msg); break;
            case 'draw_text': this._drawText(msg); break;
            case 'highlight_candle': this._highlightCandle(msg); break;
            case 'clear_drawings': this._clearAllDrawings(); break;
            case 'remove_drawing': this._removeDrawing(msg.drawing_id); break;

            // ── Trading Commands ──
            case 'place_trade': this._placeTrade(msg, request_id); break;
            case 'close_trade': this._closeTrade(msg); break;
            case 'close_all': this._closeAll(); break;
            case 'modify_trade': this._modifyTrade(msg); break;

            // ── Data Requests ──
            case 'get_candles': this._respondCandles(request_id); break;
            case 'get_indicator': this._respondIndicator(msg, request_id); break;
            case 'get_account': this._respondAccount(request_id); break;
            case 'get_positions': this._respondPositions(request_id); break;
            case 'get_trade_history': this._respondTradeHistory(request_id); break;
            case 'get_current_price': this._respondCurrentPrice(request_id); break;
            case 'get_replay_state': this._respondReplayState(request_id); break;

            // ── UI Commands ──
            case 'notify': this._showNotify(msg); break;
            case 'log': this._log(msg.message); break;
            case 'add_button': this._addButton(msg); break;
            case 'set_panel_html': this._setPanelHTML(msg); break;

            // ── Subscriptions ──
            case 'subscribe': this._eventSubscriptions[msg.event] = true; break;
            case 'unsubscribe': delete this._eventSubscriptions[msg.event]; break;

            // ── Response to our request ──
            case 'response':
                if (request_id && this._pendingRequests[request_id]) {
                    this._pendingRequests[request_id](msg.data);
                    delete this._pendingRequests[request_id];
                }
                break;

            default:
                console.warn('[Bridge] Unknown command:', type);
        }
    },

    // ═══════════ DRAWING IMPLEMENTATIONS ═══════════

    _drawMarker(msg) {
        const { time, position, color, shape, text, id } = msg;
        const drawId = id || ('m_' + this._nextDrawingId++);
        // Use lightweight-charts markers on the candle series
        this._markerData.push({
            time, position: position || 'belowBar',
            color: color || '#2962ff', shape: shape || 'arrowUp',
            text: text || '', id: drawId,
        });
        this._applyMarkers();
        this._log(`Marker: ${text || shape} at ${time}`);
        this._sendResponse(msg.request_id, { drawing_id: drawId });
    },

    _drawBox(msg) {
        const { start_time, end_time, top, bottom, color, border_color, label, id } = msg;
        const drawId = id || ('b_' + this._nextDrawingId++);
        // Approximate box by drawing top/bottom lines between start and end
        // Using two area series to shade the box
        const bgColor = color || 'rgba(41,98,255,0.15)';
        const borderCol = border_color || '#2962ff';

        // Top line
        const topSeries = ChartManager.mainChart.addSeries(LightweightCharts.LineSeries, {
            color: borderCol, lineWidth: 1, lineStyle: 2,
            priceLineVisible: false, lastValueVisible: false,
        });
        topSeries.setData([{ time: start_time, value: top }, { time: end_time, value: top }]);

        // Bottom line
        const botSeries = ChartManager.mainChart.addSeries(LightweightCharts.LineSeries, {
            color: borderCol, lineWidth: 1, lineStyle: 2,
            priceLineVisible: false, lastValueVisible: false,
        });
        botSeries.setData([{ time: start_time, value: bottom }, { time: end_time, value: bottom }]);

        this.drawings.push({ id: drawId, type: 'box', series: [topSeries, botSeries] });
        this._log(`Box: ${label || 'Zone'} ${top.toFixed(2)}-${bottom.toFixed(2)}`);
        this._sendResponse(msg.request_id, { drawing_id: drawId });
    },

    _drawLine(msg) {
        const { time1, price1, time2, price2, color, width, style, label, id } = msg;
        const drawId = id || ('l_' + this._nextDrawingId++);
        const s = ChartManager.mainChart.addSeries(LightweightCharts.LineSeries, {
            color: color || '#ff9800', lineWidth: width || 1,
            lineStyle: style || 0,
            priceLineVisible: false, lastValueVisible: false,
            title: label || '',
        });
        s.setData([{ time: time1, value: price1 }, { time: time2, value: price2 }]);
        this.drawings.push({ id: drawId, type: 'line', series: [s] });
        this._log(`Line: ${label || ''} ${price1.toFixed(2)}→${price2.toFixed(2)}`);
        this._sendResponse(msg.request_id, { drawing_id: drawId });
    },

    _drawHLine(msg) {
        const { price, color, width, style, label, id } = msg;
        const drawId = id || ('h_' + this._nextDrawingId++);
        const line = ChartManager.candleSeries.createPriceLine({
            price, color: color || '#ff9800',
            lineWidth: width || 1, lineStyle: style || 2,
            axisLabelVisible: true, title: label || '',
        });
        this.drawings.push({ id: drawId, type: 'hline', priceLine: line });
        this._log(`H-Line: ${label || ''} @${price.toFixed(2)}`);
        this._sendResponse(msg.request_id, { drawing_id: drawId });
    },

    _drawText(msg) {
        // Text is implemented as a marker with text
        const { time, price, text, color, id } = msg;
        const drawId = id || ('t_' + this._nextDrawingId++);
        this._markerData.push({
            time, position: 'aboveBar', color: color || '#d1d4dc',
            shape: 'circle', text: text || '', id: drawId, size: 0,
        });
        this._applyMarkers();
        this._sendResponse(msg.request_id, { drawing_id: drawId });
    },

    _highlightCandle(msg) {
        // Highlight via marker
        const { time, color, id } = msg;
        const drawId = id || ('hl_' + this._nextDrawingId++);
        this._markerData.push({
            time, position: 'aboveBar', color: color || 'rgba(255,235,59,0.5)',
            shape: 'circle', text: '●', id: drawId,
        });
        this._applyMarkers();
        this._sendResponse(msg.request_id, { drawing_id: drawId });
    },

    _applyMarkers() {
        try {
            ChartManager.candleSeries.setMarkers(
                this._markerData
                    .sort((a, b) => a.time - b.time)
                    .map(m => ({ time: m.time, position: m.position, color: m.color, shape: m.shape, text: m.text, size: m.size }))
            );
        } catch (e) { /* markers may fail if no data yet */ }
    },

    _clearAllDrawings() {
        // Remove series drawings
        for (const d of this.drawings) {
            if (d.series) d.series.forEach(s => { try { ChartManager.mainChart.removeSeries(s); } catch (e) { } });
            if (d.priceLine) { try { ChartManager.candleSeries.removePriceLine(d.priceLine); } catch (e) { } }
        }
        this.drawings = [];
        this._markerData = [];
        try { ChartManager.candleSeries.setMarkers([]); } catch (e) { }
        this._log('All drawings cleared');
    },

    _removeDrawing(drawId) {
        if (!drawId) return;
        // Remove from markers
        this._markerData = this._markerData.filter(m => m.id !== drawId);
        this._applyMarkers();
        // Remove from series drawings
        const idx = this.drawings.findIndex(d => d.id === drawId);
        if (idx >= 0) {
            const d = this.drawings[idx];
            if (d.series) d.series.forEach(s => { try { ChartManager.mainChart.removeSeries(s); } catch (e) { } });
            if (d.priceLine) { try { ChartManager.candleSeries.removePriceLine(d.priceLine); } catch (e) { } }
            this.drawings.splice(idx, 1);
        }
    },

    // ═══════════ TRADING IMPLEMENTATIONS ═══════════

    _placeTrade(msg, requestId) {
        const { side, lots, leverage, tp, sl, symbol } = msg;
        const price = ReplayEngine.getCurrentPrice();
        if (!price) { this._sendResponse(requestId, { error: 'No price data' }); return; }
        const pos = TradingEngine.openPosition(
            side || 'buy', lots || 0.1, leverage || 10,
            price, tp || null, sl || null, symbol || ''
        );
        this._log(`Trade: ${side} ${lots}L @${price.toFixed(2)}`);
        this._sendResponse(requestId, { position_id: pos.id, entry_price: price });
    },

    _closeTrade(msg) {
        const price = ReplayEngine.getCurrentPrice();
        TradingEngine.closePosition(msg.position_id, price);
        this._log(`Closed position #${msg.position_id}`);
    },

    _closeAll() {
        const price = ReplayEngine.getCurrentPrice();
        TradingEngine.closeAll(price);
        this._log('All positions closed');
    },

    _modifyTrade(msg) {
        const { position_id, tp, sl } = msg;
        if (tp !== undefined) TradingEngine.updateTPSL(position_id, 'tp', tp);
        if (sl !== undefined) TradingEngine.updateTPSL(position_id, 'sl', sl);
        this._log(`Modified position #${position_id}`);
    },

    // ═══════════ DATA RESPONSES ═══════════

    _respondCandles(requestId) {
        const candles = ChartManager._lastCandles || [];
        this._sendResponse(requestId, {
            candles: candles.map(c => ({
                time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
            }))
        });
    },

    _respondIndicator(msg, requestId) {
        const { name, period } = msg;
        const candles = ChartManager._lastCandles || [];
        let data = [];
        switch (name) {
            case 'sma': data = Indicators.sma(candles, period || 20); break;
            case 'ema': data = Indicators.ema(candles, period || 12); break;
            case 'rsi': data = Indicators.rsi(candles, period || 14); break;
            case 'bb': data = Indicators.bollingerBands(candles, period || 20, msg.mult || 2); break;
            case 'macd': data = Indicators.macd(candles, msg.fast || 12, msg.slow || 26, msg.signal || 9); break;
            default: data = [];
        }
        this._sendResponse(requestId, { indicator: name, data });
    },

    _respondAccount(requestId) {
        const equity = TradingEngine.balance + TradingEngine.positions.reduce((s, p) => s + p.pnl, 0);
        this._sendResponse(requestId, {
            balance: TradingEngine.balance,
            equity,
            unrealized_pnl: TradingEngine.positions.reduce((s, p) => s + p.pnl, 0),
            total_trades: TradingEngine.history.length,
            win_rate: TradingEngine.history.length > 0
                ? Math.round((TradingEngine.history.filter(h => h.pnl > 0).length / TradingEngine.history.length) * 100)
                : 0,
        });
    },

    _respondPositions(requestId) {
        this._sendResponse(requestId, {
            positions: TradingEngine.positions.map(p => ({
                id: p.id, side: p.side, lots: p.lots, leverage: p.leverage,
                entry_price: p.entryPrice, tp: p.tp, sl: p.sl, pnl: p.pnl, symbol: p.symbol,
            }))
        });
    },

    _respondTradeHistory(requestId) {
        this._sendResponse(requestId, { trades: TradingEngine.getFullHistory() });
    },

    _respondCurrentPrice(requestId) {
        this._sendResponse(requestId, { price: ReplayEngine.getCurrentPrice() });
    },

    _respondReplayState(requestId) {
        this._sendResponse(requestId, {
            is_playing: ReplayEngine.isPlaying,
            index: ReplayEngine.replayIndex,
            total: ReplayEngine._getAgg().length,
            speed: ReplayEngine.speed,
            timeframe: ReplayEngine.currentTF,
        });
    },

    _sendResponse(requestId, data) {
        if (!requestId) return;
        this._send({ type: 'response', request_id: requestId, data });
    },

    // ═══════════ UI COMMANDS ═══════════

    _showNotify(msg) {
        const statusBar = document.getElementById('status-bar');
        if (!statusBar) return;
        statusBar.className = msg.level || 'success';
        statusBar.classList.remove('hidden');
        statusBar.textContent = msg.message;
        if (msg.duration !== 0) setTimeout(() => statusBar.classList.add('hidden'), msg.duration || 5000);
    },

    _addButton(msg) {
        const { label, button_id, color } = msg;
        const container = document.getElementById('bridge-buttons');
        if (!container) return;
        const btn = document.createElement('button');
        btn.className = 'btn-secondary bridge-custom-btn';
        btn.textContent = label;
        btn.dataset.buttonId = button_id;
        if (color) btn.style.borderColor = color;
        btn.addEventListener('click', () => {
            this._send({ type: 'event', event: 'button_click', button_id });
        });
        container.appendChild(btn);
        this.customButtons.push({ id: button_id, el: btn });
    },

    _setPanelHTML(msg) {
        const panel = document.getElementById('bridge-custom-panel');
        if (panel) panel.innerHTML = msg.html || '';
    },

    // ═══════════ OUTGOING EVENTS (Chart → Python) ═══════════

    /** Called by ReplayEngine on each new candle */
    emitCandle(candle) {
        if (!this.connected || !this._eventSubscriptions['candle']) return;
        this._send({
            type: 'event', event: 'candle',
            data: { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }
        });
    },

    /** Called when a trade is opened */
    emitTradeOpen(pos) {
        if (!this.connected || !this._eventSubscriptions['trade_open']) return;
        this._send({
            type: 'event', event: 'trade_open',
            data: { id: pos.id, side: pos.side, lots: pos.lots, entry_price: pos.entryPrice, tp: pos.tp, sl: pos.sl }
        });
    },

    /** Called when a trade is closed */
    emitTradeClose(pos) {
        if (!this.connected || !this._eventSubscriptions['trade_close']) return;
        this._send({
            type: 'event', event: 'trade_close',
            data: { id: pos.id, side: pos.side, lots: pos.lots, entry_price: pos.entryPrice, exit_price: pos.exitPrice, pnl: pos.pnl }
        });
    },

    /** Called on replay state change */
    emitReplayState(state) {
        if (!this.connected || !this._eventSubscriptions['replay_state']) return;
        this._send({ type: 'event', event: 'replay_state', data: state });
    },

    /** Called on timeframe change */
    emitTimeframeChange(tf) {
        if (!this.connected || !this._eventSubscriptions['timeframe_change']) return;
        this._send({ type: 'event', event: 'timeframe_change', data: { timeframe: tf } });
    },
};

/* ═══════════════ Trading Simulation Engine ═══════════════ */

const TradingEngine = {
    balance: 10000,
    startingBalance: 10000,
    positions: [],
    history: [],
    nextId: 1,
    assetType: 'crypto',

    pipValues: {
        EURUSD: 10, USDJPY: 1000 / 110, GBPUSD: 10, AUDUSD: 10,
        USDCAD: 10 / 1.25, USDCHF: 10 / 0.92, NZDUSD: 10, EURJPY: 1000 / 110,
        GBPJPY: 1000 / 110, EURGBP: 10 * 1.27, AUDJPY: 1000 / 110, EURAUD: 10 / 0.65,
    },

    setAssetType(type) { this.assetType = type; },

    reset() {
        this.balance = this.startingBalance;
        this.positions = [];
        this.history = [];
        this.nextId = 1;
        this.updateUI();
    },

    // ═══════════════════════════════════════════════════════
    //  RICH CONTEXT CAPTURE
    // ═══════════════════════════════════════════════════════

    /**
     * Captures a full market + indicator snapshot at the current replay moment.
     * Returns a flat object ready to be stored with each trade.
     */
    _captureContext(candles, price) {
        if (!candles || candles.length === 0) return {};
        const n = candles.length;
        const cur = candles[n - 1];
        const prev = n >= 2 ? candles[n - 2] : cur;
        const p = ChartManager.params;

        // ── Candle geometry ──
        const bodySize = Math.abs(cur.close - cur.open);
        const range = cur.high - cur.low;
        const candleBodyRatio = range > 0 ? bodySize / range : 0;
        const upperWick = cur.high - Math.max(cur.open, cur.close);
        const lowerWick = Math.min(cur.open, cur.close) - cur.low;
        const wickRatio = lowerWick > 0 ? upperWick / lowerWick : 0;
        const gapFromPrevClose = cur.open - prev.close;

        // ── 50-candle range ──
        const lookback50 = candles.slice(-50);
        const high50 = Math.max(...lookback50.map(c => c.high));
        const low50 = Math.min(...lookback50.map(c => c.low));
        const rangeSpan = high50 - low50;
        const priceInRange = rangeSpan > 0 ? ((price - low50) / rangeSpan) * 100 : 50;

        // ── Volume ──
        const vols20 = candles.slice(-20).map(c => c.volume);
        const avgVol = vols20.reduce((a, b) => a + b, 0) / vols20.length;
        const volumeRatio = avgVol > 0 ? cur.volume / avgVol : 1;

        // ── EMA (4) — user's key indicator ──
        const ema4Data = Indicators.ema(candles, 4);
        const ema4 = Indicators.lastValue(ema4Data);
        const ema4_3ago = n >= 4 ? Indicators.valueAt(ema4Data, n - 4) : null;
        const ema4Distance = ema4 !== null ? price - ema4 : null;
        const ema4DistancePct = ema4 !== null && ema4 > 0 ? (ema4Distance / ema4) * 100 : null;
        const ema4Slope = (ema4 !== null && ema4_3ago !== null) ? ema4 - ema4_3ago : null;

        // Candles since price last touched EMA(4)
        let ema4TouchCandles = null;
        if (ema4Data) {
            for (let i = n - 2; i >= 0; i--) {
                const v = ema4Data[i] ? ema4Data[i].value : NaN;
                if (!isNaN(v)) {
                    const c2 = candles[i];
                    if (c2.low <= v && c2.high >= v) { ema4TouchCandles = (n - 1) - i; break; }
                }
            }
        }

        // ── All active EMAs / SMAs ──
        const ema1Data = Indicators.ema(candles, p.ema1);
        const ema2Data = Indicators.ema(candles, p.ema2);
        const sma1Data = Indicators.sma(candles, p.sma1);
        const sma2Data = Indicators.sma(candles, p.sma2);

        // ── RSI ──
        const rsiData = Indicators.rsi(candles, p.rsiPeriod);
        const rsiValue = Indicators.lastValue(rsiData);

        // ── MACD ──
        const macdResult = Indicators.macd(candles, p.macdFast, p.macdSlow, p.macdSignal);
        const macdLine = Indicators.lastValue(macdResult.macdLine);
        const macdSignal = Indicators.lastValue(macdResult.signalLine);
        const macdHist = macdResult.histogram.length > 0 ? macdResult.histogram[macdResult.histogram.length - 1].value : null;

        // ── Bollinger Bands ──
        const bb = Indicators.bollingerBands(candles, p.bbPeriod, p.bbMult);
        const bbUpper = Indicators.lastValue(bb.upper);
        const bbMiddle = Indicators.lastValue(bb.middle);
        const bbLower = Indicators.lastValue(bb.lower);
        const bbWidth = (bbUpper !== null && bbLower !== null) ? bbUpper - bbLower : null;
        const bbPosition = (bbUpper !== null && bbLower !== null && bbWidth > 0)
            ? ((price - bbLower) / bbWidth) * 100 : null;

        // ── ATR ──
        const atrData = Indicators.atr(candles, 14);
        const atr14 = Indicators.lastValue(atrData);

        // ── Trend direction ──
        const sma20Data = Indicators.sma(candles, 20);
        const sma20Now = Indicators.lastValue(sma20Data);
        const sma20_10ago = n >= 11 ? Indicators.valueAt(sma20Data, n - 11) : null;
        const trendDirection = (sma20Now !== null && sma20_10ago !== null)
            ? (sma20Now > sma20_10ago ? 'up' : sma20Now < sma20_10ago ? 'down' : 'sideways')
            : 'unknown';

        // ── Time context ──
        const dt = new Date(cur.time * 1000);
        const dayOfWeek = dt.getUTCDay(); // 0=Sun
        const hourOfDay = dt.getUTCHours();

        return {
            // Candle
            candle: { open: cur.open, high: cur.high, low: cur.low, close: cur.close, volume: cur.volume, time: cur.time },
            candleBodyRatio: +candleBodyRatio.toFixed(4),
            wickRatio: +wickRatio.toFixed(4),
            gapFromPrevClose: +gapFromPrevClose.toFixed(6),
            // Price context
            price: +price.toFixed(8),
            priceInRange50: +priceInRange.toFixed(2),
            recentHigh50: +high50.toFixed(8),
            recentLow50: +low50.toFixed(8),
            // Volume
            volumeRatio: +volumeRatio.toFixed(3),
            // EMA(4) — key indicator for user's strategy
            ema4: ema4 !== null ? +ema4.toFixed(8) : null,
            ema4Distance: ema4Distance !== null ? +ema4Distance.toFixed(8) : null,
            ema4DistancePct: ema4DistancePct !== null ? +ema4DistancePct.toFixed(4) : null,
            ema4Slope: ema4Slope !== null ? +ema4Slope.toFixed(8) : null,
            ema4TouchCandles,
            // Active indicator snapshots
            ema1: { period: p.ema1, value: Indicators.lastValue(ema1Data) !== null ? +Indicators.lastValue(ema1Data).toFixed(8) : null },
            ema2: { period: p.ema2, value: Indicators.lastValue(ema2Data) !== null ? +Indicators.lastValue(ema2Data).toFixed(8) : null },
            sma1: { period: p.sma1, value: Indicators.lastValue(sma1Data) !== null ? +Indicators.lastValue(sma1Data).toFixed(8) : null },
            sma2: { period: p.sma2, value: Indicators.lastValue(sma2Data) !== null ? +Indicators.lastValue(sma2Data).toFixed(8) : null },
            rsi: rsiValue !== null ? +rsiValue.toFixed(2) : null,
            macd: { line: macdLine, signal: macdSignal, histogram: macdHist },
            bb: { upper: bbUpper, middle: bbMiddle, lower: bbLower, width: bbWidth, position: bbPosition !== null ? +bbPosition.toFixed(2) : null },
            atr14: atr14 !== null ? +atr14.toFixed(8) : null,
            // Market structure
            trendDirection,
            // Time
            timestamp: cur.time,
            datetime: dt.toISOString().replace('T', ' ').substring(0, 19),
            dayOfWeek,
            hourOfDay,
            // Replay state
            timeframe: ReplayEngine.currentTF,
            openOnlyMode: ReplayEngine.openOnly,
            replayIndex: ReplayEngine.replayIndex,
        };
    },

    // ═══════════════════════════════════════════════════════
    //  POSITION MANAGEMENT
    // ═══════════════════════════════════════════════════════

    openPosition(side, lots, leverage, entryPrice, tp, sl, symbol) {
        const candles = ChartManager._lastCandles;
        const openContext = this._captureContext(candles, entryPrice);

        const pos = {
            id: this.nextId++, side, lots, leverage, entryPrice,
            tp: tp || null, sl: sl || null,
            symbol: symbol || '',
            openTime: Date.now(),
            openReplayIndex: ReplayEngine.replayIndex,
            pnl: 0,
            // Context at open
            openContext,
            // MFE / MAE tracking
            _maxPnl: 0,
            _minPnl: 0,
        };

        // Run addon onOpen hooks
        if (typeof TradeAddonManager !== 'undefined') {
            pos.addonOpenData = TradeAddonManager.onOpen(candles, entryPrice, openContext);
        }

        this.positions.push(pos);
        this.updateUI();
        return pos;
    },

    closePosition(id, exitPrice) {
        const idx = this.positions.findIndex(p => p.id === id);
        if (idx === -1) return;
        const pos = this.positions[idx];

        // Cancelled: opened and closed on same candle while paused
        const isCancelled = pos.openReplayIndex === ReplayEngine.replayIndex;

        if (!isCancelled) {
            pos.pnl = this.calcPnL(pos, exitPrice);
            pos.exitPrice = exitPrice;
            pos.closeTime = Date.now();

            const candles = ChartManager._lastCandles;
            pos.closeContext = this._captureContext(candles, exitPrice);

            // Finalise MFE/MAE
            pos.mfe = +pos._maxPnl.toFixed(2); // Max Favorable Excursion
            pos.mae = +pos._minPnl.toFixed(2); // Max Adverse Excursion
            pos.duration = ReplayEngine.replayIndex - pos.openReplayIndex; // candles held

            // Run addon onClose hooks
            if (typeof TradeAddonManager !== 'undefined') {
                pos.addonCloseData = TradeAddonManager.onClose(candles, exitPrice, pos.closeContext, pos.addonOpenData);
            }

            this.balance += pos.pnl;
            const { _maxPnl, _minPnl, ...clean } = pos;
            this.history.push(clean);
        }

        this.positions.splice(idx, 1);
        this.updateUI();
    },

    closeAll(currentPrice) {
        while (this.positions.length > 0) this.closePosition(this.positions[0].id, currentPrice);
    },

    calcPnL(pos, currentPrice) {
        const dir = pos.side === 'buy' ? 1 : -1;
        const priceDiff = (currentPrice - pos.entryPrice) * dir;
        if (this.assetType === 'forex') {
            const symbol = pos.symbol || '';
            const isJPY = symbol.includes('JPY');
            const pipSize = isJPY ? 0.01 : 0.0001;
            const pips = priceDiff / pipSize;
            const pipVal = (this.pipValues[symbol] || 10) * pos.lots;
            return pips * pipVal;
        } else {
            return priceDiff * pos.lots * pos.leverage;
        }
    },

    onTick(candle) {
        const closed = [];
        for (const pos of [...this.positions]) {
            if (pos.tp !== null) {
                if ((pos.side === 'buy' && candle.high >= pos.tp) || (pos.side === 'sell' && candle.low <= pos.tp)) {
                    this.closePosition(pos.id, pos.tp); closed.push(pos.id); continue;
                }
            }
            if (pos.sl !== null) {
                if ((pos.side === 'buy' && candle.low <= pos.sl) || (pos.side === 'sell' && candle.high >= pos.sl)) {
                    this.closePosition(pos.id, pos.sl); closed.push(pos.id); continue;
                }
            }
        }
        // Update live P&L + track MFE/MAE
        for (const pos of this.positions) {
            pos.pnl = this.calcPnL(pos, candle.close);
            if (pos.pnl > pos._maxPnl) pos._maxPnl = pos.pnl;
            if (pos.pnl < pos._minPnl) pos._minPnl = pos.pnl;
        }
        if (this.positions.length > 0 || closed.length > 0) this.updateUI();
        return closed;
    },

    updateTPSL(posId, field, value) {
        const pos = this.positions.find(p => p.id === posId);
        if (!pos) return;
        pos[field] = value;
        this.updateUI();
    },

    // ═══════════════════════════════════════════════════════
    //  EXPORT
    // ═══════════════════════════════════════════════════════

    exportHistoryJSON() {
        return JSON.stringify(this.history, null, 2);
    },

    downloadHistoryJSON() {
        if (this.history.length === 0) { alert('No trades in history to export.'); return; }
        const json = this.exportHistoryJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trade_history_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // ═══════════════════════════════════════════════════════
    //  UI RENDERING
    // ═══════════════════════════════════════════════════════

    updateUI() {
        const equity = this.balance + this.positions.reduce((s, p) => s + p.pnl, 0);
        const unrealizedPnl = this.positions.reduce((s, p) => s + p.pnl, 0);
        const fmt = (v) => '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const el = (id) => document.getElementById(id);

        const balEl = el('acct-balance'), eqEl = el('acct-equity'), pnlEl = el('acct-pnl');
        const trEl = el('acct-trades'), wrEl = el('acct-winrate');

        if (balEl) balEl.textContent = fmt(this.balance);
        if (eqEl) eqEl.textContent = fmt(equity);
        if (pnlEl) { pnlEl.textContent = fmt(unrealizedPnl); pnlEl.style.color = unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)'; }
        const total = this.history.length;
        if (trEl) trEl.textContent = total;
        if (wrEl) {
            if (total > 0) { const wins = this.history.filter(h => h.pnl > 0).length; wrEl.textContent = Math.round((wins / total) * 100) + '%'; }
            else wrEl.textContent = '—';
        }
        this.renderPositions();
        this.renderHistory();
    },

    renderPositions() {
        const container = document.getElementById('open-positions');
        if (!container) return;
        if (!this.positions.length) { container.innerHTML = '<div class="empty-state">No open positions</div>'; return; }
        const fmt = (v) => '$' + v.toFixed(2);
        const prec = (p) => p > 10 ? 2 : 5;
        container.innerHTML = this.positions.map(p => `
      <div class="position-card" data-pos-id="${p.id}">
        <div class="pos-header">
          <span class="pos-side ${p.side}">${p.side} ${p.lots.toFixed(3)}L @${p.leverage}×</span>
          <button class="pos-close" data-close-id="${p.id}">✕</button>
        </div>
        <div class="pos-details">
          <span>Entry</span><strong>${p.entryPrice.toFixed(prec(p.entryPrice))}</strong>
          <span>TP</span><strong>${p.tp ? p.tp.toFixed(prec(p.entryPrice)) : '—'}</strong>
          <span>SL</span><strong>${p.sl ? p.sl.toFixed(prec(p.entryPrice)) : '—'}</strong>
        </div>
        <div class="pos-pnl ${p.pnl >= 0 ? 'positive' : 'negative'}">${fmt(p.pnl)}</div>
      </div>
    `).join('');
    },

    renderHistory() {
        const container = document.getElementById('trade-history');
        if (!container) return;
        if (!this.history.length) { container.innerHTML = '<div class="empty-state">No closed trades</div>'; return; }
        const fmt = (v) => (v >= 0 ? '+' : '') + '$' + v.toFixed(2);
        const recent = this.history.slice(-50).reverse();
        container.innerHTML = recent.map((h, i) => `
      <div class="history-card ${h.pnl >= 0 ? 'hist-win' : 'hist-loss'}" data-hist-idx="${this.history.length - 1 - i}">
        <div class="hist-row">
          <span class="hist-side ${h.side}">${h.side.toUpperCase()}</span>
          <span class="hist-lots">${h.lots.toFixed(3)}L</span>
          <span class="hist-time">${h.openContext ? h.openContext.datetime : ''}</span>
          <span class="hist-pnl ${h.pnl >= 0 ? 'positive' : 'negative'}">${fmt(h.pnl)}</span>
        </div>
        <div class="hist-meta">
          <span>Entry ${h.entryPrice > 10 ? h.entryPrice.toFixed(2) : h.entryPrice.toFixed(5)}</span>
          <span>Exit ${h.exitPrice ? (h.exitPrice > 10 ? h.exitPrice.toFixed(2) : h.exitPrice.toFixed(5)) : '—'}</span>
          <span>MFE <span class="positive">+$${(h.mfe || 0).toFixed(2)}</span></span>
          <span>MAE <span class="negative">$${(h.mae || 0).toFixed(2)}</span></span>
          <span>${h.duration || 0} candles</span>
        </div>
        <button class="hist-detail-btn" data-hist-idx="${this.history.length - 1 - i}">Details ▸</button>
      </div>
    `).join('');
    },

    /** Render full context for the detail modal */
    renderDetailModal(idx) {
        const h = this.history[idx];
        if (!h) return;
        const modal = document.getElementById('trade-detail-modal');
        const body = document.getElementById('trade-detail-body');
        if (!modal || !body) return;

        const fmt = v => v !== null && v !== undefined ? String(v) : '—';
        const row = (label, val) => `<tr><td class="ctx-label">${label}</td><td class="ctx-val">${fmt(val)}</td></tr>`;

        const showAll = body._showAll || false;

        const oc = h.openContext || {};
        const cc = h.closeContext || {};

        // Always-visible summary
        let html = `
            <div class="detail-section">
                <div class="detail-section-title">Trade Summary</div>
                <table class="ctx-table">
                    ${row('Side', h.side?.toUpperCase())}
                    ${row('Symbol', h.symbol)}
                    ${row('Lots', h.lots)}
                    ${row('Leverage', h.leverage + '×')}
                    ${row('Entry Price', h.entryPrice)}
                    ${row('Exit Price', h.exitPrice || '—')}
                    ${row('TP', h.tp || '—')}
                    ${row('SL', h.sl || '—')}
                    ${row('P&L', '$' + (h.pnl || 0).toFixed(2))}
                    ${row('MFE (best)', '$' + (h.mfe || 0).toFixed(2))}
                    ${row('MAE (worst)', '$' + (h.mae || 0).toFixed(2))}
                    ${row('Duration', (h.duration || 0) + ' candles')}
                    ${row('Timeframe', oc.timeframe ? oc.timeframe + 'm' : '—')}
                </table>
            </div>
            <div class="detail-section">
                <div class="detail-section-title">EMA(4) — Key Indicator at Entry</div>
                <table class="ctx-table">
                    ${row('EMA(4) Value', oc.ema4)}
                    ${row('Distance from Price', oc.ema4Distance)}
                    ${row('Distance %', oc.ema4DistancePct !== null ? oc.ema4DistancePct + '%' : '—')}
                    ${row('Slope (3 candle)', oc.ema4Slope)}
                    ${row('Candles Since Touch', oc.ema4TouchCandles)}
                </table>
            </div>`;

        if (showAll) {
            html += `
            <div class="detail-section">
                <div class="detail-section-title">Market Context at Entry</div>
                <table class="ctx-table">
                    ${row('Datetime', oc.datetime)}
                    ${row('Day of Week', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][oc.dayOfWeek] || '—')}
                    ${row('Hour (UTC)', oc.hourOfDay)}
                    ${row('Price', oc.price)}
                    ${row('Price in 50-candle Range', oc.priceInRange50 + '%')}
                    ${row('Recent High (50)', oc.recentHigh50)}
                    ${row('Recent Low (50)', oc.recentLow50)}
                    ${row('Candle Body Ratio', oc.candleBodyRatio)}
                    ${row('Wick Ratio (up/down)', oc.wickRatio)}
                    ${row('Gap from Prev Close', oc.gapFromPrevClose)}
                    ${row('Volume Ratio vs avg20', oc.volumeRatio)}
                    ${row('Trend Direction', oc.trendDirection)}
                    ${row('ATR(14)', oc.atr14)}
                </table>
            </div>
            <div class="detail-section">
                <div class="detail-section-title">All Indicators at Entry</div>
                <table class="ctx-table">
                    ${row('RSI', oc.rsi)}
                    ${row('EMA1 (' + (oc.ema1?.period || '?') + ')', oc.ema1?.value)}
                    ${row('EMA2 (' + (oc.ema2?.period || '?') + ')', oc.ema2?.value)}
                    ${row('SMA1 (' + (oc.sma1?.period || '?') + ')', oc.sma1?.value)}
                    ${row('SMA2 (' + (oc.sma2?.period || '?') + ')', oc.sma2?.value)}
                    ${row('MACD Line', oc.macd?.line)}
                    ${row('MACD Signal', oc.macd?.signal)}
                    ${row('MACD Histogram', oc.macd?.histogram)}
                    ${row('BB Upper', oc.bb?.upper)}
                    ${row('BB Middle', oc.bb?.middle)}
                    ${row('BB Lower', oc.bb?.lower)}
                    ${row('BB Width', oc.bb?.width)}
                    ${row('BB Position %', oc.bb?.position + '%')}
                </table>
            </div>
            <div class="detail-section">
                <div class="detail-section-title">Market Context at Exit</div>
                <table class="ctx-table">
                    ${row('Datetime', cc.datetime)}
                    ${row('Price', cc.price)}
                    ${row('Price in 50-candle Range', cc.priceInRange50 + '%')}
                    ${row('EMA(4)', cc.ema4)}
                    ${row('EMA(4) Distance', cc.ema4Distance)}
                    ${row('EMA(4) Distance %', cc.ema4DistancePct + '%')}
                    ${row('RSI', cc.rsi)}
                    ${row('ATR(14)', cc.atr14)}
                    ${row('Trend Direction', cc.trendDirection)}
                </table>
            </div>`;

            // Addon data (if any)
            if (h.addonOpenData && Object.keys(h.addonOpenData).length > 0) {
                html += `<div class="detail-section">
                    <div class="detail-section-title">🧩 Addon Data at Entry</div>
                    <table class="ctx-table">
                        ${Object.entries(h.addonOpenData).map(([k, v]) => row(k, typeof v === 'object' ? JSON.stringify(v) : v)).join('')}
                    </table>
                </div>`;
            }
            if (h.addonCloseData && Object.keys(h.addonCloseData).length > 0) {
                html += `<div class="detail-section">
                    <div class="detail-section-title">🧩 Addon Data at Exit</div>
                    <table class="ctx-table">
                        ${Object.entries(h.addonCloseData).map(([k, v]) => row(k, typeof v === 'object' ? JSON.stringify(v) : v)).join('')}
                    </table>
                </div>`;
            }
        }

        html += `<div class="detail-toggle-row">
            <button class="detail-toggle-btn" id="btn-toggle-detail">
                ${showAll ? '▲ Show Less' : '▼ See All Detail'}
            </button>
            <button class="detail-export-single-btn" id="btn-export-single">Export This Trade</button>
        </div>`;

        body.innerHTML = html;
        body._showAll = showAll;
        body._histIdx = idx;

        document.getElementById('btn-toggle-detail').onclick = () => {
            body._showAll = !body._showAll;
            this.renderDetailModal(idx);
        };
        document.getElementById('btn-export-single').onclick = () => {
            const blob = new Blob([JSON.stringify(h, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `trade_${idx + 1}.json`; a.click();
            URL.revokeObjectURL(url);
        };

        modal.classList.remove('hidden');
    },
};

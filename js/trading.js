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
    //  POSITION MANAGEMENT
    // ═══════════════════════════════════════════════════════

    openPosition(side, lots, leverage, entryPrice, tp, sl, symbol) {
        const candles = ChartManager._lastCandles || [];

        // Check if any addon wants to block this trade
        if (typeof TradeAddonManager !== 'undefined') {
            const blockResult = TradeAddonManager.onBeforeTrade(candles, entryPrice, { side, lots, leverage, tp, sl, symbol });
            if (blockResult !== true) {
                const reason = typeof blockResult === 'string' ? blockResult : 'Trade blocked by addon';
                console.warn('[TradingEngine]', reason);
                return null;
            }
        }

        const pos = {
            id: this.nextId++, side, lots, leverage, entryPrice,
            tp: (tp !== null && tp !== undefined && !isNaN(tp)) ? tp : null,
            sl: (sl !== null && sl !== undefined && !isNaN(sl)) ? sl : null,
            symbol: symbol || '',
            openTime: Date.now(),
            openReplayIndex: ReplayEngine.replayIndex,
            _openBaseIdx: ReplayEngine._subMode ? ReplayEngine._baseIdx : -1,
            pnl: 0,
            // MFE / MAE tracking (internal)
            _maxPnl: 0,
            _minPnl: 0,
        };

        // Run addon onOpen hooks (addon system provides all the rich context)
        if (typeof TradeAddonManager !== 'undefined') {
            pos.addonData = TradeAddonManager.onOpen(candles, entryPrice, {});
        }

        this.positions.push(pos);
        this.updateUI();
        return pos;
    },

    closePosition(id, exitPrice) {
        const idx = this.positions.findIndex(p => p.id === id);
        if (idx === -1) return;
        const pos = this.positions[idx];

        // Cancelled: opened and closed on same candle while paused (normal mode only).
        // In open-only mode, same-candle TP/SL fills are legitimate since
        // the user only saw the open — the wicks are real unseen price action.
        const isCancelled = !ReplayEngine.openOnly && pos.openReplayIndex === ReplayEngine.replayIndex;

        if (!isCancelled) {
            pos.pnl = this.calcPnL(pos, exitPrice);
            pos.exitPrice = exitPrice;
            pos.closeTime = Date.now();

            // Finalise MFE/MAE
            pos.mfe = +pos._maxPnl.toFixed(2);
            pos.mae = +pos._minPnl.toFixed(2);
            pos.duration = ReplayEngine.replayIndex - pos.openReplayIndex;

            // Run addon onClose hooks
            if (typeof TradeAddonManager !== 'undefined') {
                const candles = ChartManager._lastCandles || [];
                const closeAddon = TradeAddonManager.onClose(candles, exitPrice, {}, pos.addonData);
                // Merge close addon data into each addon's entry
                for (const [name, data] of Object.entries(closeAddon)) {
                    if (pos.addonData && pos.addonData[name]) {
                        pos.addonData[name]._close = data;
                    } else {
                        if (!pos.addonData) pos.addonData = {};
                        pos.addonData[name] = { _close: data };
                    }
                }
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

    /** Force-close all open positions at the given price. */
    closeAll(price) {
        for (const pos of [...this.positions]) {
            this.closePosition(pos.id, price);
        }
    },

    onTick(candle) {
        const closed = [];
        for (const pos of [...this.positions]) {
            // Skip TP/SL check for positions opened on this exact frame —
            // otherwise a trade placed while paused gets instantly cancelled
            // if TP/SL falls within the current candle's high/low range.
            // EXCEPTION: In open-only mode, the user only saw the open price,
            // so the candle's wicks are unseen price action → DO check TP/SL.
            if (!ReplayEngine.openOnly) {
                if (ReplayEngine._subMode) {
                    if (pos._openBaseIdx >= 0 && pos._openBaseIdx === ReplayEngine._baseIdx) continue;
                } else {
                    if (pos.openReplayIndex === ReplayEngine.replayIndex) continue;
                }
            }

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

        // Addon per-tick hooks (drawdown checks, prop firm rules, etc.)
        if (typeof TradeAddonManager !== 'undefined') {
            const equity = this.balance + this.positions.reduce((s, p) => s + p.pnl, 0);
            TradeAddonManager.onEveryTick(candle, equity, this.balance);
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

    downloadHistoryJSON() {
        if (this.history.length === 0) { alert('No trades in history to export.'); return; }
        const json = JSON.stringify(this.history, null, 2);
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

        const totalPnl = equity - this.startingBalance;
        if (balEl) balEl.textContent = fmt(this.balance);
        if (eqEl) eqEl.textContent = fmt(equity);
        if (pnlEl) { pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + fmt(totalPnl); pnlEl.style.color = totalPnl >= 0 ? 'var(--green)' : 'var(--red)'; }
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
          <span class="hist-pnl ${h.pnl >= 0 ? 'positive' : 'negative'}">${fmt(h.pnl)}</span>
        </div>
        <div class="hist-meta">
          <span>In ${h.entryPrice > 10 ? h.entryPrice.toFixed(2) : h.entryPrice.toFixed(5)}</span>
          <span>Out ${h.exitPrice ? (h.exitPrice > 10 ? h.exitPrice.toFixed(2) : h.exitPrice.toFixed(5)) : '—'}</span>
          <span>MFE <span class="positive">+$${(h.mfe || 0).toFixed(2)}</span></span>
          <span>MAE <span class="negative">$${(h.mae || 0).toFixed(2)}</span></span>
          <span>${h.duration || 0}c</span>
        </div>
        <button class="hist-detail-btn" data-hist-idx="${this.history.length - 1 - i}">Details ▸</button>
      </div>
    `).join('');
    },

    renderDetailModal(idx) {
        const h = this.history[idx];
        if (!h) return;
        const modal = document.getElementById('trade-detail-modal');
        const body = document.getElementById('trade-detail-body');
        if (!modal || !body) return;

        const fmt = v => (v !== null && v !== undefined) ? String(v) : '—';
        const row = (label, val) => `<tr><td class="ctx-label">${label}</td><td class="ctx-val">${fmt(val)}</td></tr>`;
        const prec = h.entryPrice > 10 ? 2 : 5;

        let html = `
            <div class="detail-section">
                <div class="detail-section-title">Trade Summary</div>
                <table class="ctx-table">
                    ${row('Side', h.side?.toUpperCase())}
                    ${row('Symbol', h.symbol)}
                    ${row('Lots', h.lots)}
                    ${row('Leverage', h.leverage + '×')}
                    ${row('Entry Price', h.entryPrice?.toFixed(prec))}
                    ${row('Exit Price', h.exitPrice ? h.exitPrice.toFixed(prec) : '—')}
                    ${row('TP', h.tp ? h.tp.toFixed(prec) : '—')}
                    ${row('SL', h.sl ? h.sl.toFixed(prec) : '—')}
                    ${row('P&L', '$' + (h.pnl || 0).toFixed(2))}
                    ${row('MFE (best)', '$' + (h.mfe || 0).toFixed(2))}
                    ${row('MAE (worst)', '$' + (h.mae || 0).toFixed(2))}
                    ${row('Duration', (h.duration || 0) + ' candles')}
                </table>
            </div>`;

        // Addon sections — each addon's data gets its own collapsible
        if (h.addonData && Object.keys(h.addonData).length > 0) {
            for (const [addonName, data] of Object.entries(h.addonData)) {
                if (!data) continue;
                const openFields = Object.entries(data).filter(([k]) => k !== '_close');
                const closeFields = data._close ? Object.entries(data._close) : [];

                if (openFields.length > 0) {
                    html += `<div class="detail-section">
                        <div class="detail-section-title">${addonName} — at Open</div>
                        <table class="ctx-table">
                            ${openFields.map(([k, v]) => row(k, typeof v === 'object' ? JSON.stringify(v) : v)).join('')}
                        </table>
                    </div>`;
                }
                if (closeFields.length > 0) {
                    html += `<div class="detail-section">
                        <div class="detail-section-title">${addonName} — at Close</div>
                        <table class="ctx-table">
                            ${closeFields.map(([k, v]) => row(k, typeof v === 'object' ? JSON.stringify(v) : v)).join('')}
                        </table>
                    </div>`;
                }
            }
        }

        html += `<div class="detail-toggle-row">
            <button class="detail-export-single-btn" id="btn-export-single">Export This Trade (JSON)</button>
        </div>`;

        body.innerHTML = html;

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

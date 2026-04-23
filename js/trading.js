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

    /**
     * Open position — now captures EMA snapshot at entry time.
     */
    openPosition(side, lots, leverage, entryPrice, tp, sl, symbol) {
        // Snapshot EMA values at entry
        const candles = ChartManager._lastCandles;
        const emaSnap = ChartManager.getEMASnapshot(candles);

        const pos = {
            id: this.nextId++, side, lots, leverage, entryPrice,
            tp: tp || null, sl: sl || null,
            symbol: symbol || '',
            openTime: Date.now(),
            pnl: 0,
            entryEMA: emaSnap, // { ema1, ema2, ema1Period, ema2Period }
        };
        this.positions.push(pos);
        this.updateUI();
        return pos;
    },

    closePosition(id, exitPrice) {
        const idx = this.positions.findIndex(p => p.id === id);
        if (idx === -1) return;
        const pos = this.positions[idx];
        pos.pnl = this.calcPnL(pos, exitPrice);
        pos.exitPrice = exitPrice;
        pos.closeTime = Date.now();

        // Snapshot EMA at close
        const candles = ChartManager._lastCandles;
        pos.exitEMA = ChartManager.getEMASnapshot(candles);

        this.balance += pos.pnl;
        this.history.push({ ...pos });
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
        for (const pos of this.positions) pos.pnl = this.calcPnL(pos, candle.close);
        if (this.positions.length > 0 || closed.length > 0) this.updateUI();
        return closed;
    },

    updateTPSL(posId, field, value) {
        const pos = this.positions.find(p => p.id === posId);
        if (!pos) return;
        pos[field] = value;
        this.updateUI();
    },

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
          <span>TP</span><strong>${p.tp ? p.tp.toFixed(prec(p.entryPrice)) : '— drag↕'}</strong>
          <span>SL</span><strong>${p.sl ? p.sl.toFixed(prec(p.entryPrice)) : '— drag↕'}</strong>
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
        const recent = this.history.slice(-20).reverse();
        container.innerHTML = recent.map((h, i) => `
      <div class="history-card ${h.pnl >= 0 ? 'hist-win' : 'hist-loss'}">
        <span class="hist-side ${h.side}">${h.side.toUpperCase()}</span>
        <span class="hist-lots">${h.lots.toFixed(3)}L</span>
        <span class="pos-pnl ${h.pnl >= 0 ? 'positive' : 'negative'}">${fmt(h.pnl)}</span>
      </div>
    `).join('');
    },

    /** Get detailed trade info for a specific history entry */
    getDetailedTrade(index) {
        const h = this.history[index];
        if (!h) return null;
        const prec = (p) => p > 10 ? 2 : 5;
        return {
            side: h.side, symbol: h.symbol, lots: h.lots, leverage: h.leverage,
            entryPrice: h.entryPrice.toFixed(prec(h.entryPrice)),
            exitPrice: h.exitPrice ? h.exitPrice.toFixed(prec(h.entryPrice)) : '—',
            tp: h.tp ? h.tp.toFixed(prec(h.entryPrice)) : '—',
            sl: h.sl ? h.sl.toFixed(prec(h.entryPrice)) : '—',
            pnl: h.pnl,
            entryEMA: h.entryEMA || {},
            exitEMA: h.exitEMA || {},
        };
    },

    /** Get all history as detailed array */
    getFullHistory() {
        return this.history.map((_, i) => this.getDetailedTrade(i));
    },
};

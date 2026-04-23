/* ═══════════════ Main Application ═══════════════ */

(function () {
    'use strict';
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    // ─── DOM refs ───
    const tabs = $$('#tabs .tab');
    const tabContents = { crypto: $('#tab-crypto'), forex: $('#tab-forex'), csv: $('#tab-csv') };
    const statusBar = $('#status-bar');
    const cryptoSymbol = $('#crypto-symbol'), cryptoCustom = $('#crypto-custom');
    const cryptoDate = $('#crypto-date'), tfSelect = $('#timeframe');
    const btnFetch = $('#btn-fetch-binance'), btnDownload = $('#btn-download-csv');
    const forexSymbol = $('#forex-symbol'), forexDate = $('#forex-date');
    const btnMT5 = $('#btn-fetch-mt5');
    const csvFile = $('#csv-file');
    const csvModal = $('#csv-modal'), csvMappingTable = $('#csv-mapping-table');
    const csvConfirm = $('#csv-confirm'), csvCancel = $('#csv-cancel');

    // Trading
    const tradeTabs = $$('.tt-tab');
    const tradeLots = $('#trade-lots'), tradeUSDT = $('#trade-usdt');
    const tradeLeverage = $('#trade-leverage');
    const tradeTP = $('#trade-tp'), tradeSL = $('#trade-sl');
    const btnPlaceTrade = $('#btn-place-trade'), btnCloseAll = $('#btn-close-all');

    // Indicators
    const btnIndicators = $('#btn-indicators');
    const indDropdown = $('#ind-dropdown');
    const indApply = $('#ind-apply');
    const indicatorChecks = $$('#ind-dropdown input[data-ind]');

    // PineScript
    const pineModal = $('#pine-modal');
    const pineName = $('#pine-name'), pineCode = $('#pine-code');
    const pineSave = $('#pine-save'), pineCancel = $('#pine-cancel');
    const btnPineNew = $('#btn-pine-new');
    const pineList = $('#pine-list');

    // Detail History
    const detailModal = $('#detail-modal');
    const detailTableWrap = $('#detail-table-wrap');
    const btnDetailHistory = $('#btn-detailed-history');
    const detailClose = $('#detail-close');

    // ─── State ───
    let rawBaseData = null, csvParsedData = null;
    let currentSide = 'buy', currentSymbol = 'BTCUSDT', activeTab = 'crypto';
    let editingPineId = null; // null = new, string = editing existing

    // ─── Helpers ───
    function showStatus(msg, type) {
        statusBar.className = type || '';
        statusBar.classList.remove('hidden');
        statusBar.innerHTML = type ? msg : `<span class="spinner"></span> ${msg}`;
    }
    function hideStatus() { statusBar.classList.add('hidden'); }
    function setDefaultDates() {
        const d = new Date(); d.setDate(d.getDate() - 30);
        const iso = d.toISOString().split('T')[0];
        cryptoDate.value = iso; forexDate.value = iso;
    }

    // ─── Tabs ───
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(tabContents).forEach(tc => tc.classList.remove('active'));
            tabContents[tab.dataset.tab].classList.add('active');
            activeTab = tab.dataset.tab;
            TradingEngine.setAssetType(activeTab === 'crypto' ? 'crypto' : 'forex');
        });
    });

    cryptoSymbol.addEventListener('change', () => {
        if (cryptoSymbol.value === '__custom__') { cryptoCustom.classList.remove('hidden'); cryptoCustom.focus(); }
        else { cryptoCustom.classList.add('hidden'); }
    });

    // ─── Fetch from Binance ───
    btnFetch.addEventListener('click', async () => {
        const symbol = cryptoSymbol.value === '__custom__' ? cryptoCustom.value.trim().toUpperCase() : cryptoSymbol.value;
        if (!symbol) { alert('Enter a symbol'); return; }
        const startDate = cryptoDate.value;
        if (!startDate) { alert('Select a start date'); return; }
        currentSymbol = symbol;
        btnFetch.disabled = true;
        try {
            showStatus(`Fetching ${symbol} from Binance…`);
            rawBaseData = await fetchAllBinanceData(symbol, startDate, showStatus);
            if (!rawBaseData.length) { showStatus('No data returned.', 'error'); btnFetch.disabled = false; return; }
            downloadCSV(rawBaseData, `${symbol}_5m_${startDate}.csv`);
            showStatus(`✓ ${rawBaseData.length} bars loaded.`, 'success');
            btnDownload.classList.remove('hidden');
            btnDownload.onclick = () => downloadCSV(rawBaseData, `${symbol}_5m.csv`);
            TradingEngine.setAssetType('crypto');
            TradingEngine.reset();
            startReplay(rawBaseData, parseInt(tfSelect.value));
            setTimeout(hideStatus, 3000);
        } catch (err) { showStatus('Error: ' + err.message, 'error'); console.error(err); }
        btnFetch.disabled = false;
    });

    tfSelect.addEventListener('change', () => {
        if (rawBaseData && rawBaseData.length) ReplayEngine.switchTimeframe(parseInt(tfSelect.value));
    });

    // ─── Forex MT5 ───
    btnMT5.addEventListener('click', () => {
        currentSymbol = forexSymbol.value;
        showStatus(`Testing MT5 for ${currentSymbol}…`);
        setTimeout(() => {
            showStatus(`MT5 bridge needed. Export from MT5 as CSV and use "Load CSV" tab.`, 'error');
            setTimeout(() => {
                tabs.forEach(t => t.classList.remove('active'));
                $$('#tabs .tab')[2].classList.add('active');
                Object.values(tabContents).forEach(tc => tc.classList.remove('active'));
                tabContents.csv.classList.add('active');
                activeTab = 'csv';
            }, 1500);
        }, 800);
    });

    // ─── CSV ───
    csvFile.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try { const p = parseCSVText(ev.target.result); showCSVModal(p, autoDetectMapping(p.headers)); }
            catch (err) { showStatus('CSV error: ' + err.message, 'error'); }
        };
        reader.readAsText(file);
    });
    function showCSVModal(parsed, mapping) {
        csvParsedData = parsed;
        csvModal.classList.remove('hidden');
        const fields = ['date', 'open', 'high', 'low', 'close', 'volume'];
        let html = '<table><thead><tr><th>Field</th><th>Column</th>';
        for (let i = 0; i < Math.min(3, parsed.rows.length); i++) html += `<th>Row ${i + 1}</th>`;
        html += '</tr></thead><tbody>';
        for (const f of fields) {
            html += `<tr><td>${f}</td><td><select data-field="${f}"><option value="-1">— skip —</option>`;
            for (let c = 0; c < parsed.headers.length; c++)
                html += `<option value="${c}" ${mapping[f] === c ? 'selected' : ''}>${parsed.headers[c]}</option>`;
            html += '</select></td>';
            for (let r = 0; r < Math.min(3, parsed.rows.length); r++)
                html += `<td>${mapping[f] >= 0 ? parsed.rows[r][mapping[f]] || '' : ''}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
        csvMappingTable.innerHTML = html;
    }
    csvConfirm.addEventListener('click', () => {
        if (!csvParsedData) return;
        const mapping = {};
        csvMappingTable.querySelectorAll('select').forEach(s => { mapping[s.dataset.field] = parseInt(s.value); });
        try {
            rawBaseData = csvRowsToCandles(csvParsedData.rows, mapping);
            if (!rawBaseData.length) throw new Error('No valid candles');
            csvModal.classList.add('hidden');
            showStatus(`✓ ${rawBaseData.length} candles from CSV.`, 'success');
            TradingEngine.setAssetType(activeTab === 'crypto' ? 'crypto' : 'forex');
            TradingEngine.reset();
            startReplay(rawBaseData, parseInt(tfSelect.value));
            setTimeout(hideStatus, 3000);
        } catch (err) { showStatus('Error: ' + err.message, 'error'); }
    });
    csvCancel.addEventListener('click', () => { csvModal.classList.add('hidden'); csvParsedData = null; });

    // ─── Indicator Dropdown ───
    btnIndicators.addEventListener('click', (e) => { e.stopPropagation(); indDropdown.classList.toggle('hidden'); renderPineList(); });
    document.addEventListener('click', (e) => {
        if (!indDropdown.contains(e.target) && e.target !== btnIndicators) indDropdown.classList.add('hidden');
    });

    function readIndicatorState() {
        const state = {};
        indicatorChecks.forEach(c => { state[c.dataset.ind] = c.checked; });
        return state;
    }
    function readIndicatorParams() {
        return {
            sma1: parseInt($('#p-sma1').value) || 20, sma2: parseInt($('#p-sma2').value) || 50,
            sma1On: $('#p-sma1-on').checked, sma2On: $('#p-sma2-on').checked,
            ema1: parseInt($('#p-ema1').value) || 12, ema2: parseInt($('#p-ema2').value) || 26,
            ema1On: $('#p-ema1-on').checked, ema2On: $('#p-ema2-on').checked,
            bbPeriod: parseInt($('#p-bb-period').value) || 20, bbMult: parseFloat($('#p-bb-mult').value) || 2,
            rsiPeriod: parseInt($('#p-rsi').value) || 14,
            macdFast: parseInt($('#p-macd-fast').value) || 12, macdSlow: parseInt($('#p-macd-slow').value) || 26,
            macdSignal: parseInt($('#p-macd-signal').value) || 9,
        };
    }
    function applyIndicators() {
        ChartManager.params = readIndicatorParams();
        ReplayEngine.indicatorState = readIndicatorState();
        ReplayEngine._renderFrame(false);
    }

    indApply.addEventListener('click', () => { applyIndicators(); indDropdown.classList.add('hidden'); });
    indicatorChecks.forEach(cb => { cb.addEventListener('change', applyIndicators); });

    // ─── PineScript Editor ───
    btnPineNew.addEventListener('click', (e) => {
        e.stopPropagation();
        editingPineId = null;
        pineName.value = ''; pineCode.value = '';
        pineModal.classList.remove('hidden');
    });

    pineSave.addEventListener('click', () => {
        const name = pineName.value.trim() || 'Custom Indicator';
        const code = pineCode.value.trim();
        if (!code) { alert('Enter PineScript code'); return; }
        if (editingPineId) {
            const s = PineEngine.scripts.find(s => s.id === editingPineId);
            if (s) { s.name = name; PineEngine.updateScript(editingPineId, code); }
        } else {
            PineEngine.addScript(name, code);
        }
        pineModal.classList.add('hidden');
        renderPineList();
        applyIndicators();
    });
    pineCancel.addEventListener('click', () => pineModal.classList.add('hidden'));

    function renderPineList() {
        if (!pineList) return;
        if (!PineEngine.scripts.length) {
            pineList.innerHTML = '<div style="font-size:10px;color:var(--text-dim);padding:4px 0">No custom indicators yet</div>';
            return;
        }
        pineList.innerHTML = PineEngine.scripts.map(s => `
      <div class="pine-item" data-pine-id="${s.id}">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} class="pine-toggle">
        <span class="pine-name">${s.name}</span>
        <button class="pine-edit" title="Edit">✏️</button>
        <button class="pine-del" title="Delete">🗑️</button>
      </div>
    `).join('');

        pineList.querySelectorAll('.pine-toggle').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.closest('.pine-item').dataset.pineId;
                PineEngine.toggleScript(id);
                applyIndicators();
            });
        });
        pineList.querySelectorAll('.pine-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.closest('.pine-item').dataset.pineId;
                const s = PineEngine.scripts.find(s => s.id === id);
                if (!s) return;
                editingPineId = id;
                pineName.value = s.name;
                pineCode.value = s.code;
                pineModal.classList.remove('hidden');
            });
        });
        pineList.querySelectorAll('.pine-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.closest('.pine-item').dataset.pineId;
                PineEngine.removeScript(id);
                renderPineList();
                applyIndicators();
            });
        });
    }

    // ─── Trading Panel ───
    tradeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tradeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentSide = tab.dataset.side;
            btnPlaceTrade.textContent = currentSide === 'buy' ? 'Place Buy' : 'Place Sell';
            btnPlaceTrade.className = currentSide === 'buy' ? 'btn-trade-buy' : 'btn-trade-buy btn-trade-sell';
        });
    });

    // ─── Pick-from-chart TP/SL ───
    const btnPickTP = document.getElementById('btn-pick-tp');
    const btnPickSL = document.getElementById('btn-pick-sl');

    btnPickTP.addEventListener('click', () => {
        if (ChartManager._pickMode === 'tp') { ChartManager.exitPickMode(); return; }
        ChartManager.exitPickMode();
        ChartManager.enterPickMode('tp');
    });
    btnPickSL.addEventListener('click', () => {
        if (ChartManager._pickMode === 'sl') { ChartManager.exitPickMode(); return; }
        ChartManager.exitPickMode();
        ChartManager.enterPickMode('sl');
    });
    // ESC cancels pick mode
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && ChartManager._pickMode) ChartManager.exitPickMode();
    });

    tradeUSDT.addEventListener('input', () => {
        const usdt = parseFloat(tradeUSDT.value);
        const price = ReplayEngine.getCurrentPrice();
        if (usdt > 0 && price > 0) tradeLots.value = (usdt / price).toFixed(4);
    });

    btnPlaceTrade.addEventListener('click', () => {
        const price = ReplayEngine.getCurrentPrice();
        if (!price) { alert('Load data and start replay first'); return; }
        const usdt = parseFloat(tradeUSDT.value);
        let lots = usdt > 0 && price > 0 ? usdt / price : (parseFloat(tradeLots.value) || 0.1);
        if (usdt > 0) tradeLots.value = lots.toFixed(4);
        const lev = parseInt(tradeLeverage.value) || 10;
        const tp = parseFloat(tradeTP.value) || null;
        const sl = parseFloat(tradeSL.value) || null;
        TradingEngine.openPosition(currentSide, lots, lev, price, tp, sl, currentSymbol);
        tradeTP.value = ''; tradeSL.value = ''; tradeUSDT.value = '';
        // Instant fill: force render so position lines appear even when paused
        ReplayEngine._renderFrame(false);
    });

    btnCloseAll.addEventListener('click', () => {
        const price = ReplayEngine.getCurrentPrice();
        if (price) TradingEngine.closeAll(price);
        // Update chart immediately
        ReplayEngine._renderFrame(false);
    });

    document.getElementById('open-positions').addEventListener('click', (e) => {
        const btn = e.target.closest('.pos-close');
        if (!btn) return;
        TradingEngine.closePosition(parseInt(btn.dataset.closeId), ReplayEngine.getCurrentPrice());
        ReplayEngine._renderFrame(false);
    });

    // ─── Detailed History Modal ───
    btnDetailHistory.addEventListener('click', () => {
        const trades = TradingEngine.getFullHistory();
        if (!trades.length) { alert('No trade history yet'); return; }

        let html = `<table class="detail-table">
      <thead><tr>
        <th>#</th><th>Side</th><th>Symbol</th><th>Lots</th><th>Lev</th>
        <th>Entry</th><th>Exit</th><th>TP</th><th>SL</th>
        <th>P&L</th><th>EMA at Entry</th><th>EMA at Close</th>
      </tr></thead><tbody>`;

        trades.forEach((t, i) => {
            const pnlClass = t.pnl >= 0 ? 'dt-win' : 'dt-loss';
            const fmtPnl = (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(2);
            const fmtEMA = (ema) => {
                if (!ema || (!ema.ema1 && !ema.ema2)) return '—';
                const parts = [];
                if (ema.ema1 !== null) parts.push(`${ema.ema1Period}: ${ema.ema1.toFixed(2)}`);
                if (ema.ema2 !== null) parts.push(`${ema.ema2Period}: ${ema.ema2.toFixed(2)}`);
                return parts.join('<br>');
            };
            html += `<tr>
        <td>${i + 1}</td>
        <td class="${t.side === 'buy' ? 'dt-win' : 'dt-loss'}">${t.side.toUpperCase()}</td>
        <td>${t.symbol}</td><td>${t.lots.toFixed(3)}</td><td>${t.leverage}×</td>
        <td>${t.entryPrice}</td><td>${t.exitPrice}</td>
        <td>${t.tp}</td><td>${t.sl}</td>
        <td class="${pnlClass}">${fmtPnl}</td>
        <td class="dt-ema">${fmtEMA(t.entryEMA)}</td>
        <td class="dt-ema">${fmtEMA(t.exitEMA)}</td>
      </tr>`;
        });

        html += '</tbody></table>';
        detailTableWrap.innerHTML = html;
        detailModal.classList.remove('hidden');
    });

    detailClose.addEventListener('click', () => detailModal.classList.add('hidden'));

    // ─── Start Replay ───
    function startReplay(data, tf) {
        ReplayEngine.loadData(data, tf);
        setTimeout(() => ReplayEngine.play(), 300);
    }

    // ─── Boot ───
    function boot() {
        setDefaultDates();
        PineEngine.init();
        ChartManager.init();
        ReplayEngine.init();
        BridgeClient.init();
        ReplayEngine.indicatorState = readIndicatorState();
        ChartManager.params = readIndicatorParams();
        TradingEngine.updateUI();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();

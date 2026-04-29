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
    const btnFetch = $('#btn-fetch-binance'), btnDownload = $('#btn-download-csv'), btnClearCache = $('#btn-clear-cache');
    const forexSymbol = $('#forex-symbol'), forexDate = $('#forex-date');
    const btnMT5 = $('#btn-fetch-mt5');
    const csvFile = $('#csv-file');

    // ─── Clear Cache ───
    btnClearCache.addEventListener('click', async () => {
        if (!confirm('Delete all cached historical data? You will need to re-fetch.')) return;
        await clearAllCandles();
        alert('Cache cleared.');
    });
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

    // Detail Modal
    const tradeDetailModal = $('#trade-detail-modal');
    const btnCloseDetailModal = $('#btn-close-detail-modal');
    const btnExportHistory = $('#btn-export-history');

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
        const saved = localStorage.getItem('lbr_start_date');
        const iso = saved || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })();
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
        let earlyStarted = false;
        try {
            showStatus(`Fetching ${symbol} from Binance…`);
            rawBaseData = await fetchAllBinanceData(symbol, startDate, showStatus, (partialData, isFinal) => {
                if (!earlyStarted && !isFinal) {
                    // First chunk — start replay immediately
                    earlyStarted = true;
                    TradingEngine.setAssetType('crypto');
                    TradingEngine.reset();
                    rawBaseData = partialData;
                    startReplay(partialData, parseInt(tfSelect.value));
                    showStatus(`Playing with ${partialData.length} bars… still fetching more in background`);
                } else if (isFinal) {
                    // Background fetch finished — silently extend the data
                    rawBaseData = partialData;
                    ReplayEngine.baseData = partialData;
                    showStatus(`✓ ${partialData.length} bars fully loaded.`, 'success');
                    setTimeout(hideStatus, 3000);
                }
            });
            localStorage.setItem('lbr_start_date', startDate);

            if (!earlyStarted) {
                // Short date range — no progressive load happened, start normally
                if (!rawBaseData.length) { showStatus('No data returned.', 'error'); btnFetch.disabled = false; return; }
                showStatus(`✓ ${rawBaseData.length} bars loaded.`, 'success');
                TradingEngine.setAssetType('crypto');
                TradingEngine.reset();
                startReplay(rawBaseData, parseInt(tfSelect.value));
                setTimeout(hideStatus, 3000);
            }

            btnDownload.classList.remove('hidden');
            btnDownload.onclick = () => downloadCSV(rawBaseData, `${symbol}_5m.csv`);
        } catch (err) { showStatus('Error: ' + err.message, 'error'); console.error(err); }
        btnFetch.disabled = false;
    });

    tfSelect.addEventListener('change', () => {
        if (rawBaseData && rawBaseData.length) ReplayEngine.switchTimeframe(parseInt(tfSelect.value));
    });

    // ─── Open-Only Toggle ───
    const btnOpenOnly = document.getElementById('btn-open-only');
    btnOpenOnly.addEventListener('click', () => {
        ReplayEngine.openOnly = !ReplayEngine.openOnly;
        btnOpenOnly.classList.toggle('ctrl-active', ReplayEngine.openOnly);
        ReplayEngine._renderFrame(false);
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
        localStorage.setItem('lbr_ind_state', JSON.stringify(ReplayEngine.indicatorState));
        localStorage.setItem('lbr_ind_params', JSON.stringify(ChartManager.params));
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

    // ─── Per-trade context detail modal ───
    // Close modal
    btnCloseDetailModal.addEventListener('click', () => tradeDetailModal.classList.add('hidden'));
    tradeDetailModal.addEventListener('click', (e) => { if (e.target === tradeDetailModal) tradeDetailModal.classList.add('hidden'); });

    // Click on a "Details ▸" button in the history list
    document.getElementById('trade-history').addEventListener('click', (e) => {
        const btn = e.target.closest('.hist-detail-btn');
        if (!btn) return;
        const idx = parseInt(btn.dataset.histIdx);
        if (!isNaN(idx)) TradingEngine.renderDetailModal(idx);
    });

    // ─── Export all trades as JSON ───
    btnExportHistory.addEventListener('click', () => TradingEngine.downloadHistoryJSON());

    // ─── Start Replay ───
    function startReplay(data, tf) {
        ReplayEngine.loadData(data, tf);
        setTimeout(() => ReplayEngine.play(), 300);
    }

    // ─── Restore saved indicator preferences ───
    function restoreIndicatorPrefs() {
        try {
            const savedState = JSON.parse(localStorage.getItem('lbr_ind_state'));
            const savedParams = JSON.parse(localStorage.getItem('lbr_ind_params'));
            if (savedState) {
                indicatorChecks.forEach(c => { if (savedState[c.dataset.ind] !== undefined) c.checked = savedState[c.dataset.ind]; });
            }
            if (savedParams) {
                if ($('#p-sma1')) $('#p-sma1').value = savedParams.sma1 || 20;
                if ($('#p-sma2')) $('#p-sma2').value = savedParams.sma2 || 50;
                if ($('#p-sma1-on')) $('#p-sma1-on').checked = savedParams.sma1On !== false;
                if ($('#p-sma2-on')) $('#p-sma2-on').checked = savedParams.sma2On !== false;
                if ($('#p-ema1')) $('#p-ema1').value = savedParams.ema1 || 12;
                if ($('#p-ema2')) $('#p-ema2').value = savedParams.ema2 || 26;
                if ($('#p-ema1-on')) $('#p-ema1-on').checked = savedParams.ema1On !== false;
                if ($('#p-ema2-on')) $('#p-ema2-on').checked = savedParams.ema2On !== false;
                if ($('#p-bb-period')) $('#p-bb-period').value = savedParams.bbPeriod || 20;
                if ($('#p-bb-mult')) $('#p-bb-mult').value = savedParams.bbMult || 2;
                if ($('#p-rsi')) $('#p-rsi').value = savedParams.rsiPeriod || 14;
                if ($('#p-macd-fast')) $('#p-macd-fast').value = savedParams.macdFast || 12;
                if ($('#p-macd-slow')) $('#p-macd-slow').value = savedParams.macdSlow || 26;
                if ($('#p-macd-signal')) $('#p-macd-signal').value = savedParams.macdSignal || 9;
            }
        } catch (e) { }
    }

    // ─── Boot ───
    function boot() {
        setDefaultDates();
        restoreIndicatorPrefs();
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

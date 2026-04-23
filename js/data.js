/* ═══════════════ Data Fetching: Binance API + CSV + Smart Caching ═══════════════ */

/**
 * Fetch klines from Binance public API (single page, max 1000 bars).
 */
async function fetchBinanceKlinesPage(symbol, interval, startTime, endTime) {
    const url = new URL('https://api.binance.com/api/v3/klines');
    url.searchParams.set('symbol', symbol.toUpperCase());
    url.searchParams.set('interval', interval);
    url.searchParams.set('startTime', startTime);
    if (endTime) url.searchParams.set('endTime', endTime);
    url.searchParams.set('limit', '1000');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
    return res.json();
}

function binanceInterval(minutes) {
    const map = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h', 720: '12h', 1440: '1d' };
    return map[minutes] || '5m';
}

/**
 * Build the IDB cache key for a given symbol + date.
 */
function cacheKey(symbol, startDate) {
    return `${symbol.toUpperCase()}_5m_${startDate}`;
}

/**
 * Check if we have cached data that covers the requested date range.
 * Returns the cached data if it covers the range, or null.
 */
async function checkCache(symbol, startDate) {
    const key = cacheKey(symbol, startDate);
    const cached = await loadFromIDB(key);
    if (cached && cached.length > 0) return cached;

    // Also check if we have a longer series that includes this date
    // by scanning all keys matching this symbol
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction('candles', 'readonly');
        const store = tx.objectStore('candles');
        const req = store.getAllKeys();
        req.onsuccess = async () => {
            const prefix = symbol.toUpperCase() + '_5m_';
            const matchingKeys = (req.result || []).filter(k => typeof k === 'string' && k.startsWith(prefix));
            const targetStart = new Date(startDate).getTime() / 1000;

            for (const mk of matchingKeys) {
                const data = await loadFromIDB(mk);
                if (data && data.length > 0 && data[0].time <= targetStart) {
                    // This cached data starts before our requested date — reuse it
                    return resolve(data);
                }
            }
            resolve(null);
        };
        req.onerror = () => resolve(null);
    });
}

/**
 * Merge new data into existing cached data (extend the series).
 */
function mergeData(existing, newData) {
    const map = new Map();
    for (const bar of existing) map.set(bar.time, bar);
    for (const bar of newData) map.set(bar.time, bar);
    const merged = Array.from(map.values());
    merged.sort((a, b) => a.time - b.time);
    return merged;
}

/**
 * Auto-paginated fetch of all 5m klines from startDate to now.
 * Checks cache first; merges if existing data is found.
 */
async function fetchAllBinanceData(symbol, startDate, onProgress) {
    // Check cache
    if (onProgress) onProgress('Checking local cache…');
    const cached = await checkCache(symbol, startDate);

    let startTime;
    if (cached && cached.length > 0) {
        // We have some cached data — only fetch what's new
        const lastCachedTime = cached[cached.length - 1].time * 1000;
        startTime = lastCachedTime + 1;
        if (onProgress) onProgress(`Found ${cached.length} cached bars. Fetching updates…`);
    } else {
        startTime = new Date(startDate).getTime();
    }

    const endTime = Date.now();
    const allBars = [];
    let page = 0;

    while (startTime < endTime) {
        page++;
        if (onProgress) onProgress(`Fetching page ${page}… (${allBars.length} new bars)`);
        const raw = await fetchBinanceKlinesPage(symbol, '5m', startTime, endTime);
        if (!raw || raw.length === 0) break;

        for (const k of raw) {
            allBars.push({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(k[1]), high: parseFloat(k[2]),
                low: parseFloat(k[3]), close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
            });
        }
        startTime = raw[raw.length - 1][0] + 1;
        if (raw.length === 1000) {
            await new Promise(r => setTimeout(r, 120));
        } else break;
    }

    // Merge with cached data
    let result;
    if (cached && cached.length > 0) {
        result = mergeData(cached, allBars);
    } else {
        // Deduplicate
        const seen = new Set();
        result = [];
        for (const bar of allBars) {
            if (!seen.has(bar.time)) { seen.add(bar.time); result.push(bar); }
        }
        result.sort((a, b) => a.time - b.time);
    }

    // Save merged result to cache under both the original key and the new key
    const key = cacheKey(symbol, startDate);
    await saveToIDB(key, result);

    return result;
}

/** Convert candle array to CSV string. */
function candlesToCSV(data) {
    const header = 'timestamp,open,high,low,close,volume';
    const rows = data.map(d => `${new Date(d.time * 1000).toISOString()},${d.open},${d.high},${d.low},${d.close},${d.volume}`);
    return header + '\n' + rows.join('\n');
}

/** Trigger file download. */
function downloadCSV(data, filename) {
    const csv = candlesToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'candles.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

/** Parse CSV text into rows. */
function parseCSVText(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have at least a header and one data row');
    const delim = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delim).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delim).map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= headers.length) rows.push(cols);
    }
    return { headers, rows };
}

/** Auto-detect column mapping from headers. */
function autoDetectMapping(headers) {
    const lc = headers.map(h => h.toLowerCase());
    const find = (keys) => { for (const k of keys) { const i = lc.findIndex(h => h.includes(k)); if (i !== -1) return i; } return -1; };
    return {
        date: find(['time', 'date', 'timestamp', 'datetime']),
        open: find(['open']), high: find(['high']),
        low: find(['low']), close: find(['close']),
        volume: find(['vol']),
    };
}

/** Convert CSV rows to candles using mapping. */
function csvRowsToCandles(rows, mapping) {
    const candles = [];
    for (const row of rows) {
        const dateStr = mapping.date >= 0 ? row[mapping.date] : null;
        if (!dateStr) continue;
        let ts;
        const num = Number(dateStr);
        if (!isNaN(num) && num > 1e9) {
            ts = num > 1e12 ? Math.floor(num / 1000) : num;
        } else {
            const d = new Date(dateStr.replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3'));
            ts = Math.floor(d.getTime() / 1000);
        }
        if (isNaN(ts)) continue;
        candles.push({
            time: ts, open: parseFloat(row[mapping.open]) || 0,
            high: parseFloat(row[mapping.high]) || 0, low: parseFloat(row[mapping.low]) || 0,
            close: parseFloat(row[mapping.close]) || 0,
            volume: mapping.volume >= 0 ? parseFloat(row[mapping.volume]) || 0 : 0,
        });
    }
    candles.sort((a, b) => a.time - b.time);
    return candles;
}

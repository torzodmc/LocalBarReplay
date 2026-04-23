/* ═══════════════ PineScript Mini-Interpreter ═══════════════ */
/*
 * Supports a subset of PineScript v5 syntax:
 *   - ta.sma(source, length), ta.ema(source, length)
 *   - ta.rsi(source, length)
 *   - ta.crossover(a, b), ta.crossunder(a, b)
 *   - close, open, high, low, volume as series
 *   - plot(series, title, color)
 *   - input.int(defval, title), input.float(defval, title)
 *   - Basic math: +, -, *, /
 *   - Variable assignment: myVar = ta.sma(close, 14)
 *
 * Scripts are saved to localStorage and persist across sessions.
 */

const PineEngine = {
    scripts: [],  // { id, name, code, enabled }
    STORAGE_KEY: 'localbarreplay_pine_scripts',

    init() {
        this.load();
    },

    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            this.scripts = raw ? JSON.parse(raw) : [];
        } catch (e) { this.scripts = []; }
    },

    save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.scripts));
    },

    addScript(name, code) {
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
        this.scripts.push({ id, name: name || 'Custom Indicator', code, enabled: true });
        this.save();
        return id;
    },

    removeScript(id) {
        this.scripts = this.scripts.filter(s => s.id !== id);
        this.save();
    },

    toggleScript(id) {
        const s = this.scripts.find(s => s.id === id);
        if (s) { s.enabled = !s.enabled; this.save(); }
    },

    updateScript(id, code) {
        const s = this.scripts.find(s => s.id === id);
        if (s) { s.code = code; this.save(); }
    },

    /** Execute all enabled scripts against the current candle data */
    renderAll(candles) {
        ChartManager.clearCustomSeries();
        if (!candles || candles.length === 0) return;

        for (const script of this.scripts) {
            if (!script.enabled) continue;
            try {
                this._execute(script.code, candles);
            } catch (e) {
                console.warn(`PineScript error in "${script.name}":`, e.message);
            }
        }
    },

    /** Parse and execute a PineScript string */
    _execute(code, candles) {
        const lines = code.split('\n')
            .map(l => l.replace(/\/\/.*$/, '').trim())
            .filter(l => l && !l.startsWith('//@') && !l.startsWith('indicator('));

        const ctx = {
            close: candles.map(c => c.close),
            open: candles.map(c => c.open),
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            volume: candles.map(c => c.volume),
            times: candles.map(c => c.time),
            vars: {},
        };

        const plots = [];

        for (const line of lines) {
            // Variable assignment: varName = expression
            const assignMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
            if (assignMatch) {
                const varName = assignMatch[1];
                const expr = assignMatch[2].trim();
                ctx.vars[varName] = this._evalExpr(expr, ctx);
                continue;
            }

            // plot(series, title="...", color=...)
            const plotMatch = line.match(/^plot\s*\((.+)\)$/);
            if (plotMatch) {
                const args = this._splitArgs(plotMatch[1]);
                const series = this._evalExpr(args[0], ctx);
                let title = 'Custom', color = '#ff9800';
                for (let i = 1; i < args.length; i++) {
                    const kv = args[i].trim();
                    const titleM = kv.match(/title\s*=\s*["'](.+?)["']/);
                    if (titleM) title = titleM[1];
                    const colorM = kv.match(/color\s*=\s*(?:color\.)?["']?([#\w]+)["']?/);
                    if (colorM) color = this._resolveColor(colorM[1]);
                }
                if (Array.isArray(series)) {
                    plots.push({ series, title, color });
                }
                continue;
            }
        }

        // Render plots
        for (const p of plots) {
            const data = p.series.map((v, i) => ({
                time: candles[i].time,
                value: typeof v === 'number' && isFinite(v) ? v : NaN,
            }));
            ChartManager.addCustomLineSeries(data, p.color, p.title);
        }
    },

    /** Evaluate an expression in the PineScript context */
    _evalExpr(expr, ctx) {
        expr = expr.trim();

        // ta.sma(source, length)
        const smaMatch = expr.match(/^ta\.sma\s*\((.+)\)$/);
        if (smaMatch) {
            const args = this._splitArgs(smaMatch[1]);
            const source = this._evalExpr(args[0], ctx);
            const length = parseInt(this._evalExpr(args[1], ctx));
            return this._calcSMA(source, length);
        }

        // ta.ema(source, length)
        const emaMatch = expr.match(/^ta\.ema\s*\((.+)\)$/);
        if (emaMatch) {
            const args = this._splitArgs(emaMatch[1]);
            const source = this._evalExpr(args[0], ctx);
            const length = parseInt(this._evalExpr(args[1], ctx));
            return this._calcEMA(source, length);
        }

        // ta.rsi(source, length)
        const rsiMatch = expr.match(/^ta\.rsi\s*\((.+)\)$/);
        if (rsiMatch) {
            const args = this._splitArgs(rsiMatch[1]);
            const source = this._evalExpr(args[0], ctx);
            const length = parseInt(this._evalExpr(args[1], ctx));
            return this._calcRSI(source, length);
        }

        // input.int(defval, title="...") or input.float(defval, title="...")
        const inputMatch = expr.match(/^input\.\w+\s*\((\d+\.?\d*)/);
        if (inputMatch) return parseFloat(inputMatch[1]);

        // Simple math: a + b, a - b, a * b, a / b
        // Check for + or - (not inside parentheses)
        const opIdx = this._findOp(expr);
        if (opIdx > 0) {
            const left = this._evalExpr(expr.substring(0, opIdx).trim(), ctx);
            const op = expr[opIdx];
            const right = this._evalExpr(expr.substring(opIdx + 1).trim(), ctx);
            return this._applyOp(left, right, op);
        }

        // Variable reference
        if (ctx.vars[expr] !== undefined) return ctx.vars[expr];

        // Built-in series
        if (expr === 'close') return ctx.close;
        if (expr === 'open') return ctx.open;
        if (expr === 'high') return ctx.high;
        if (expr === 'low') return ctx.low;
        if (expr === 'volume') return ctx.volume;

        // Number literal
        const num = parseFloat(expr);
        if (!isNaN(num)) return num;

        return NaN;
    },

    /** Find main operator outside parentheses */
    _findOp(expr) {
        let depth = 0;
        // Scan right-to-left for +/-, then */
        for (let i = expr.length - 1; i > 0; i--) {
            if (expr[i] === ')') depth++;
            else if (expr[i] === '(') depth--;
            if (depth === 0 && (expr[i] === '+' || expr[i] === '-')) return i;
        }
        for (let i = expr.length - 1; i > 0; i--) {
            if (expr[i] === ')') depth++;
            else if (expr[i] === '(') depth--;
            if (depth === 0 && (expr[i] === '*' || expr[i] === '/')) return i;
        }
        return -1;
    },

    _applyOp(a, b, op) {
        if (Array.isArray(a) && Array.isArray(b)) {
            return a.map((v, i) => { const r = b[i]; switch (op) { case '+': return v + r; case '-': return v - r; case '*': return v * r; case '/': return r !== 0 ? v / r : NaN; } });
        }
        if (Array.isArray(a) && typeof b === 'number') {
            return a.map(v => { switch (op) { case '+': return v + b; case '-': return v - b; case '*': return v * b; case '/': return b !== 0 ? v / b : NaN; } });
        }
        if (typeof a === 'number' && Array.isArray(b)) {
            return b.map(v => { switch (op) { case '+': return a + v; case '-': return a - v; case '*': return a * v; case '/': return v !== 0 ? a / v : NaN; } });
        }
        switch (op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b !== 0 ? a / b : NaN; }
    },

    _splitArgs(str) {
        const args = []; let depth = 0; let current = '';
        for (const ch of str) {
            if (ch === '(' || ch === '[') depth++;
            else if (ch === ')' || ch === ']') depth--;
            if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; }
            else current += ch;
        }
        if (current.trim()) args.push(current.trim());
        return args;
    },

    _calcSMA(source, period) {
        if (!Array.isArray(source)) return NaN;
        const result = [];
        for (let i = 0; i < source.length; i++) {
            if (i < period - 1) { result.push(NaN); continue; }
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += source[j];
            result.push(sum / period);
        }
        return result;
    },

    _calcEMA(source, period) {
        if (!Array.isArray(source)) return NaN;
        const result = []; const k = 2 / (period + 1); let prev = null;
        for (let i = 0; i < source.length; i++) {
            if (i < period - 1) { result.push(NaN); continue; }
            if (prev === null) { let s = 0; for (let j = i - period + 1; j <= i; j++) s += source[j]; prev = s / period; }
            else { prev = source[i] * k + prev * (1 - k); }
            result.push(prev);
        }
        return result;
    },

    _calcRSI(source, period) {
        if (!Array.isArray(source) || source.length < period + 1) return source.map(() => NaN);
        const result = [];
        let avgG = 0, avgL = 0;
        for (let i = 1; i <= period; i++) {
            const c = source[i] - source[i - 1];
            if (c > 0) avgG += c; else avgL += Math.abs(c);
            result.push(NaN);
        }
        avgG /= period; avgL /= period;
        result.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
        for (let i = period + 1; i < source.length; i++) {
            const c = source[i] - source[i - 1];
            avgG = (avgG * (period - 1) + (c > 0 ? c : 0)) / period;
            avgL = (avgL * (period - 1) + (c < 0 ? Math.abs(c) : 0)) / period;
            result.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
        }
        // Pad front
        while (result.length < source.length) result.unshift(NaN);
        return result;
    },

    _resolveColor(c) {
        const map = { red: '#ef5350', green: '#26a69a', blue: '#2196f3', orange: '#ff9800', purple: '#ab47bc', yellow: '#ffeb3b', white: '#ffffff', black: '#000000', aqua: '#00bcd4', lime: '#8bc34a', fuchsia: '#e91e63', teal: '#009688' };
        return map[c] || (c.startsWith('#') ? c : '#ff9800');
    },
};

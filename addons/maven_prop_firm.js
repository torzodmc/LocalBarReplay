/**
 * Maven Prop Firm Challenge Simulator
 * Simulates Maven Trading's challenge phases with real rules.
 *
 * Enable via the addon selector in the Indicators dropdown.
 */

// ═══════════════ PLAN DEFINITIONS ═══════════════

const MAVEN_PLANS = {
    '1-step': {
        name: 'Maven 1-Step',
        phases: [
            { name: 'Phase 1', profitTarget: 0.08, dailyDD: 0.03, maxDD: 0.05, maxDDType: 'trailing', minDays: 3, dayThreshold: 0.005 },
        ],
        funded: { dailyDD: 0.03, maxDD: 0.05, maxDDType: 'trailing', minDays: 3, dayThreshold: 0.005, profitSplit: 0.80 },
    },
    '2-step': {
        name: 'Maven 2-Step',
        phases: [
            { name: 'Phase 1', profitTarget: 0.08, dailyDD: 0.04, maxDD: 0.08, maxDDType: 'static', minDays: 3, dayThreshold: 0.005 },
            { name: 'Phase 2', profitTarget: 0.05, dailyDD: 0.04, maxDD: 0.08, maxDDType: 'static', minDays: 3, dayThreshold: 0.005 },
        ],
        funded: { dailyDD: 0.04, maxDD: 0.08, maxDDType: 'static', minDays: 3, dayThreshold: 0.005, profitSplit: 0.80 },
    },
    '3-step': {
        name: 'Maven 3-Step',
        phases: [
            { name: 'Phase 1', profitTarget: 0.03, dailyDD: 0.02, maxDD: 0.03, maxDDType: 'static', minDays: 3, dayThreshold: 0.005 },
            { name: 'Phase 2', profitTarget: 0.03, dailyDD: 0.02, maxDD: 0.03, maxDDType: 'static', minDays: 3, dayThreshold: 0.005 },
            { name: 'Phase 3', profitTarget: 0.03, dailyDD: 0.02, maxDD: 0.03, maxDDType: 'static', minDays: 3, dayThreshold: 0.005 },
        ],
        funded: { dailyDD: 0.02, maxDD: 0.03, maxDDType: 'static', minDays: 3, dayThreshold: 0.005, profitSplit: 0.80 },
    },
    'instant': {
        name: 'Maven Instant',
        phases: [],
        funded: {
            dailyDD: 0.02, maxDD: 0.03, maxDDType: 'trailing', minDays: 3, dayThreshold: 0.005,
            profitSplit: 0.80, maxFloatingLoss: 0.01, consistencyRequired: true,
        },
    },
};

const ACCOUNT_SIZES = [5000, 10000, 25000, 50000, 100000, 200000];

// ═══════════════ PROP FIRM ENGINE ═══════════════

class MavenEngine {
    constructor(planId, accountSize) {
        const plan = MAVEN_PLANS[planId];
        this.planId = planId;
        this.planName = plan.name;
        this.plan = plan;
        this.accountSize = accountSize;
        this.phaseIndex = plan.phases.length === 0 ? -1 : 0; // -1 = funded (instant)
        this.status = plan.phases.length === 0 ? 'funded' : 'active'; // active | passed | failed | funded
        this.initialBalance = accountSize;
        this.highestEquity = accountSize;
        this.currentDay = null;
        this.dailyRefLevel = accountSize;
        this.dailyPnlMap = {}; // dayNum -> realized P&L
        this.profitableDays = new Set();
        this.totalRealizedPnl = 0;
        this.biggestWinningDay = 0;
        this.breachReason = null;
        this.phaseHistory = [];

        // Set the trading engine
        TradingEngine.balance = accountSize;
        TradingEngine.startingBalance = accountSize;
        TradingEngine.positions = [];
        TradingEngine.history = [];
        TradingEngine.nextId = 1;
        TradingEngine.updateUI();
    }

    get currentRules() {
        if (this.phaseIndex >= 0 && this.phaseIndex < this.plan.phases.length) {
            return this.plan.phases[this.phaseIndex];
        }
        return this.plan.funded;
    }

    get phaseName() {
        if (this.status === 'failed') return '❌ FAILED';
        if (this.phaseIndex >= 0 && this.phaseIndex < this.plan.phases.length) {
            return this.plan.phases[this.phaseIndex].name;
        }
        return '💰 Funded';
    }

    get profitPct() {
        const equity = TradingEngine.balance + TradingEngine.positions.reduce((s, p) => s + p.pnl, 0);
        return ((equity - this.initialBalance) / this.initialBalance) * 100;
    }

    // ── Tick handler ──
    tick(candle, equity, balance) {
        if (this.status === 'failed') return;
        this._lastPrice = candle.close; // cache for breach force-close

        const dayNum = Math.floor(candle.time / 86400);
        if (this.currentDay === null || dayNum !== this.currentDay) {
            this._onNewDay(dayNum, equity, balance);
        }

        // Daily drawdown check
        const rules = this.currentRules;
        const dailyFloor = this.dailyRefLevel * (1 - rules.dailyDD);
        if (equity < dailyFloor) {
            return this.breach(`Daily drawdown breached. Equity $${equity.toFixed(2)} fell below floor $${dailyFloor.toFixed(2)} (${(rules.dailyDD * 100).toFixed(0)}% of $${this.dailyRefLevel.toFixed(2)} ref level).`);
        }

        // Max drawdown check
        if (rules.maxDDType === 'trailing') {
            if (equity > this.highestEquity) this.highestEquity = equity;
            const trailFloor = this.highestEquity * (1 - rules.maxDD);
            if (equity < trailFloor) {
                return this.breach(`Trailing max drawdown breached. Equity $${equity.toFixed(2)} fell below $${trailFloor.toFixed(2)} (${(rules.maxDD * 100).toFixed(0)}% from peak $${this.highestEquity.toFixed(2)}).`);
            }
        } else {
            const staticFloor = this.initialBalance * (1 - rules.maxDD);
            if (equity < staticFloor) {
                return this.breach(`Max drawdown breached. Equity $${equity.toFixed(2)} fell below $${staticFloor.toFixed(2)} (${(rules.maxDD * 100).toFixed(0)}% of $${this.initialBalance.toFixed(2)} initial balance).`);
            }
        }

        // Instant funding: max floating loss (1%)
        if (rules.maxFloatingLoss) {
            const unrealized = equity - balance;
            const maxLoss = this.initialBalance * rules.maxFloatingLoss;
            if (unrealized < -maxLoss) {
                return this.breach(`Max floating loss breached. Unrealized P&L $${unrealized.toFixed(2)} exceeds -$${maxLoss.toFixed(2)} (${(rules.maxFloatingLoss * 100).toFixed(0)}% limit).`);
            }
        }
    }

    _onNewDay(dayNum, equity, balance) {
        // Evaluate previous day for profitable day check
        if (this.currentDay !== null) {
            const prevDayPnl = this.dailyPnlMap[this.currentDay] || 0;
            const threshold = this.initialBalance * (this.currentRules.dayThreshold || 0.005);
            if (prevDayPnl >= threshold) {
                this.profitableDays.add(this.currentDay);
            }
            // Track biggest winning day for consistency
            if (prevDayPnl > this.biggestWinningDay) this.biggestWinningDay = prevDayPnl;
        }
        this.currentDay = dayNum;
        this.dailyRefLevel = Math.max(balance, equity);
    }

    onTradeClose(pnl) {
        if (this.status === 'failed') return;
        this.totalRealizedPnl += pnl;
        const day = this.currentDay;
        if (day !== null) {
            this.dailyPnlMap[day] = (this.dailyPnlMap[day] || 0) + pnl;
        }
        this._checkPhaseCompletion();
    }

    _checkPhaseCompletion() {
        const rules = this.currentRules;
        if (!rules.profitTarget) return; // funded phase has no target
        if (this.profitPct >= rules.profitTarget * 100 && this.profitableDays.size >= rules.minDays) {
            this.advancePhase();
        }
    }

    advancePhase() {
        this.phaseHistory.push({
            phase: this.phaseName,
            profit: this.profitPct.toFixed(2) + '%',
            profitableDays: this.profitableDays.size,
        });

        if (this.phaseIndex >= 0 && this.phaseIndex < this.plan.phases.length - 1) {
            // Next challenge phase
            this.phaseIndex++;
            this.status = 'active';
        } else {
            // Move to funded
            this.phaseIndex = -1;
            this.status = 'funded';
        }

        // Reset for new phase
        this.initialBalance = this.accountSize;
        this.highestEquity = this.accountSize;
        this.profitableDays = new Set();
        this.dailyPnlMap = {};
        this.totalRealizedPnl = 0;
        this.biggestWinningDay = 0;
        this.currentDay = null;

        TradingEngine.balance = this.accountSize;
        TradingEngine.startingBalance = this.accountSize;
        TradingEngine.positions = [];
        TradingEngine.history = [];
        TradingEngine.nextId = 1;
        TradingEngine.updateUI();
    }

    breach(reason) {
        this.status = 'failed';
        this.breachReason = reason;
        // Force close all positions at last known price
        if (this._lastPrice) TradingEngine.closeAll(this._lastPrice);
        console.warn('[MavenPropFirm] BREACH:', reason);
    }

    get consistencyScore() {
        if (this.totalRealizedPnl <= 0) return 100;
        return (this.biggestWinningDay / this.totalRealizedPnl) * 100;
    }

    restart() {
        this.phaseIndex = this.plan.phases.length === 0 ? -1 : 0;
        this.status = this.plan.phases.length === 0 ? 'funded' : 'active';
        this.initialBalance = this.accountSize;
        this.highestEquity = this.accountSize;
        this.profitableDays = new Set();
        this.dailyPnlMap = {};
        this.totalRealizedPnl = 0;
        this.biggestWinningDay = 0;
        this.currentDay = null;
        this.breachReason = null;
        this.phaseHistory = [];

        TradingEngine.balance = this.accountSize;
        TradingEngine.startingBalance = this.accountSize;
        TradingEngine.positions = [];
        TradingEngine.history = [];
        TradingEngine.nextId = 1;
        TradingEngine.updateUI();
    }
}

// ═══════════════ HUD RENDERING ═══════════════

function renderPropFirmHUD(engine) {
    const el = document.getElementById('prop-firm-hud');
    if (!el) return;
    if (!engine) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    const rules = engine.currentRules;
    const equity = TradingEngine.balance + TradingEngine.positions.reduce((s, p) => s + p.pnl, 0);
    const profitPct = engine.profitPct;
    const targetPct = rules.profitTarget ? (rules.profitTarget * 100) : null;

    // Daily DD
    const dailyUsed = ((engine.dailyRefLevel - equity) / engine.dailyRefLevel) * 100;
    const dailyMax = rules.dailyDD * 100;
    const dailyPctUsed = Math.max(0, Math.min(100, (dailyUsed / dailyMax) * 100));

    // Max DD
    let maxDDUsed, maxDDMax;
    if (rules.maxDDType === 'trailing') {
        maxDDUsed = ((engine.highestEquity - equity) / engine.highestEquity) * 100;
    } else {
        maxDDUsed = ((engine.initialBalance - equity) / engine.initialBalance) * 100;
    }
    maxDDMax = rules.maxDD * 100;
    const maxDDPctUsed = Math.max(0, Math.min(100, (maxDDUsed / maxDDMax) * 100));

    const statusClass = engine.status === 'failed' ? 'pf-failed' : engine.status === 'funded' ? 'pf-funded' : 'pf-active';
    const statusBadge = engine.status === 'failed' ? '❌ FAILED'
        : engine.status === 'funded' ? '💰 FUNDED' : engine.phaseName;

    let html = `
    <div class="pf-header ${statusClass}">
        <span class="pf-plan-name">${engine.planName}</span>
        <span class="pf-phase-badge">${statusBadge}</span>
    </div>
    <div class="pf-balance">$${equity.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>`;

    if (engine.status === 'failed') {
        html += `
        <div class="pf-breach-reason">${engine.breachReason}</div>
        <button class="pf-restart-btn" onclick="document.dispatchEvent(new Event('pf-restart'))">🔄 Restart Challenge</button>`;
    } else {
        // Target progress
        if (targetPct) {
            const targetFill = Math.max(0, Math.min(100, (profitPct / targetPct) * 100));
            html += `
            <div class="pf-stat">
                <div class="pf-stat-label">Target <span>${profitPct.toFixed(2)}% / ${targetPct}%</span></div>
                <div class="pf-bar"><div class="pf-bar-fill pf-bar-green" style="width:${targetFill}%"></div></div>
            </div>`;
        }
        // Daily DD
        html += `
        <div class="pf-stat">
            <div class="pf-stat-label">Daily DD <span>${dailyUsed.toFixed(2)}% / ${dailyMax}%</span></div>
            <div class="pf-bar"><div class="pf-bar-fill pf-bar-dd ${dailyPctUsed > 75 ? 'pf-bar-danger' : ''}" style="width:${dailyPctUsed}%"></div></div>
        </div>`;
        // Max DD
        html += `
        <div class="pf-stat">
            <div class="pf-stat-label">Max DD (${rules.maxDDType}) <span>${Math.max(0, maxDDUsed).toFixed(2)}% / ${maxDDMax}%</span></div>
            <div class="pf-bar"><div class="pf-bar-fill pf-bar-dd ${maxDDPctUsed > 75 ? 'pf-bar-danger' : ''}" style="width:${maxDDPctUsed}%"></div></div>
        </div>`;
        // Profitable days
        html += `
        <div class="pf-stat">
            <div class="pf-stat-label">Profitable Days <span>${engine.profitableDays.size} / ${rules.minDays}</span></div>
            <div class="pf-days">${Array.from({length: rules.minDays}, (_, i) =>
                `<span class="pf-day-dot ${i < engine.profitableDays.size ? 'filled' : ''}"></span>`
            ).join('')}</div>
        </div>`;
        // Consistency score (instant funding)
        if (rules.consistencyRequired) {
            const cs = engine.consistencyScore;
            html += `
            <div class="pf-stat">
                <div class="pf-stat-label">Consistency <span>${cs.toFixed(1)}% ${cs <= 20 ? '✅' : '⚠️'} (≤20%)</span></div>
            </div>`;
        }
        // Floating loss (instant funding)
        if (rules.maxFloatingLoss) {
            const unrealized = equity - TradingEngine.balance;
            const maxFL = engine.initialBalance * rules.maxFloatingLoss;
            html += `
            <div class="pf-stat">
                <div class="pf-stat-label">Floating P&L <span>$${unrealized.toFixed(2)} / -$${maxFL.toFixed(2)}</span></div>
            </div>`;
        }
    }

    el.innerHTML = html;
}

// ═══════════════ SETUP UI ═══════════════

function showPropFirmSetup(onStart) {
    const acctSection = document.getElementById('account-info');
    if (!acctSection) return;

    const sizesHTML = ACCOUNT_SIZES.map(s =>
        `<option value="${s}"${s === 10000 ? ' selected' : ''}>$${s.toLocaleString()}</option>`
    ).join('');

    const plansHTML = Object.entries(MAVEN_PLANS).map(([id, p]) =>
        `<option value="${id}">${p.name}</option>`
    ).join('');

    acctSection.innerHTML = `
    <div class="pf-setup">
        <div class="pf-setup-title">🏢 Maven Challenge</div>
        <label class="pf-setup-label">Plan
            <select id="pf-plan">${plansHTML}</select>
        </label>
        <label class="pf-setup-label">Account Size
            <select id="pf-size">${sizesHTML}</select>
        </label>
        <button id="pf-start-btn" class="btn-primary" style="width:100%;margin-top:8px">Start Challenge</button>
    </div>
    <div id="prop-firm-hud" class="hidden"></div>`;

    document.getElementById('pf-start-btn').addEventListener('click', () => {
        const planId = document.getElementById('pf-plan').value;
        const size = parseInt(document.getElementById('pf-size').value);
        document.querySelector('.pf-setup').style.display = 'none';
        document.getElementById('prop-firm-hud').classList.remove('hidden');
        onStart(planId, size);
    });
}

// ═══════════════ ADDON REGISTRATION ═══════════════

let _mavenEngine = null;
let _origAccountHTML = null;

LocalBarReplay.registerTradeAddon({
    name: 'Maven Prop Firm',
    version: '1.0',
    _sourcePath: document.currentScript?.src,

    onActivate() {
        const acctSection = document.getElementById('account-info');
        if (acctSection) _origAccountHTML = acctSection.innerHTML;
        document.body.classList.add('prop-firm-active');

        // Lock leverage to 2x (Maven crypto), hide USDT, enforce min 0.01 lots
        const levSelect = document.getElementById('trade-leverage');
        if (levSelect) {
            levSelect.value = '2';
            levSelect.disabled = true;
            levSelect.title = 'Maven: Crypto leverage locked to 2×';
        }
        const usdtInput = document.getElementById('trade-usdt');
        const sizeOr = usdtInput?.previousElementSibling; // the "or" span
        if (usdtInput) usdtInput.style.display = 'none';
        if (sizeOr) sizeOr.style.display = 'none';
        const lotsInput = document.getElementById('trade-lots');
        if (lotsInput) { lotsInput.min = '0.01'; lotsInput.step = '0.01'; }

        showPropFirmSetup((planId, size) => {
            _mavenEngine = new MavenEngine(planId, size);
            renderPropFirmHUD(_mavenEngine);
        });

        document.addEventListener('pf-restart', () => {
            if (_mavenEngine) {
                _mavenEngine.restart();
                renderPropFirmHUD(_mavenEngine);
            }
        });
    },

    onDeactivate() {
        document.body.classList.remove('prop-firm-active');
        const acctSection = document.getElementById('account-info');
        if (acctSection && _origAccountHTML) acctSection.innerHTML = _origAccountHTML;
        _mavenEngine = null;

        // Restore leverage, USDT, lots
        const levSelect = document.getElementById('trade-leverage');
        if (levSelect) { levSelect.disabled = false; levSelect.value = '10'; levSelect.title = ''; }
        const usdtInput = document.getElementById('trade-usdt');
        const sizeOr = usdtInput?.previousElementSibling;
        if (usdtInput) usdtInput.style.display = '';
        if (sizeOr) sizeOr.style.display = '';

        TradingEngine.balance = 10000;
        TradingEngine.startingBalance = 10000;
        TradingEngine.positions = [];
        TradingEngine.history = [];
        TradingEngine.nextId = 1;
        TradingEngine.updateUI();
    },

    onBeforeTrade(ctx, pos) {
        if (!_mavenEngine) return true;
        if (_mavenEngine.status === 'failed') return 'Challenge failed — trading is locked.';
        if (_mavenEngine.status !== 'active' && _mavenEngine.status !== 'funded') return 'Challenge not started.';
        // Enforce Maven crypto leverage
        if (pos.leverage && pos.leverage !== 2) {
            // Silently correct it
            const levSelect = document.getElementById('trade-leverage');
            if (levSelect) levSelect.value = '2';
            return 'Maven crypto: leverage must be 2×.';
        }
        return true;
    },

    onEveryTick(candle, equity, balance) {
        if (!_mavenEngine || _mavenEngine.status === 'failed') return;
        _mavenEngine.tick(candle, equity, balance);
        renderPropFirmHUD(_mavenEngine);
    },

    onTradeOpen(ctx) { return null; },

    onTradeClose(ctx, openData) {
        if (!_mavenEngine) return null;
        // Get the last closed trade's P&L
        const hist = TradingEngine.history;
        if (hist.length > 0) {
            const last = hist[hist.length - 1];
            _mavenEngine.onTradeClose(last.pnl);
        }
        renderPropFirmHUD(_mavenEngine);
        return null;
    },
});

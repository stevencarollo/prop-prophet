const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../history/prophet_history.json');

const loadHistory = () => {
    if (!fs.existsSync(HISTORY_FILE)) {
        console.error("❌ History file not found.");
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
};

const fmtPct = (w, total) => {
    if (total === 0) return "0.0%";
    return `${((w / total) * 100).toFixed(1)}%`;
};

const runAnalysis = () => {
    const history = loadHistory();
    const VALID_RESULTS = ['WIN', 'LOSS'];
    const validPicks = history.filter(p => VALID_RESULTS.includes(p.result));

    console.log(`\n📊 PROPHET CALIBRATION REPORT`);
    console.log(`=============================`);
    console.log(`Analyzing ${validPicks.length} settled picks...`);

    // --- 1. TIER ANALYSIS ---
    const tiers = {};
    validPicks.forEach(p => {
        const t = p.tier || 'Unknown';
        if (!tiers[t]) tiers[t] = { w: 0, l: 0, total: 0 };
        tiers[t].total++;
        if (p.result === 'WIN') tiers[t].w++;
        else tiers[t].l++;
    });

    console.log(`\n🏆 Win Rates by Tier:`);
    console.table(Object.entries(tiers).map(([tier, data]) => ({
        Tier: tier,
        Wins: data.w,
        Losses: data.l,
        "Win Rate": fmtPct(data.w, data.total),
        Volume: data.total
    })).sort((a, b) => b["Win Rate"].replace('%', '') - a["Win Rate"].replace('%', '')));

    // --- 2. EDGE ANALYSIS ---
    const edges = {
        "Massive (>5.0)": { w: 0, l: 0, total: 0 },
        "Large (3.0-5.0)": { w: 0, l: 0, total: 0 },
        "Medium (1.5-3.0)": { w: 0, l: 0, total: 0 },
        "Small (<1.5)": { w: 0, l: 0, total: 0 }
    };

    validPicks.forEach(p => {
        const edge = parseFloat(p.edge || 0);
        let cat = "Small (<1.5)";
        if (edge >= 5.0) cat = "Massive (>5.0)";
        else if (edge >= 3.0) cat = "Large (3.0-5.0)";
        else if (edge >= 1.5) cat = "Medium (1.5-3.0)";

        edges[cat].total++;
        if (p.result === 'WIN') edges[cat].w++;
        else edges[cat].l++;
    });

    console.log(`\n📈 Win Rates by Edge Size:`);
    console.table(Object.entries(edges).map(([cat, data]) => ({
        Category: cat,
        "Win Rate": fmtPct(data.w, data.total),
        Volume: data.total
    })));

    // --- 3. EASE ANALYSIS (The User's Request) ---
    const easeBuckets = {
        "Positive Ease (>0.20)": { w: 0, l: 0, total: 0 },
        "Neutral Ease": { w: 0, l: 0, total: 0 },
        "Negative Ease (<-0.20)": { w: 0, l: 0, total: 0 }
    };

    // New: Contradiction Analysis
    const contradictions = { w: 0, l: 0, total: 0 }; // Betting OVER with Neg Ease or UNDER with Pos Ease

    let picksWithEase = 0;

    validPicks.forEach(p => {
        // Handle missing ease (older records)
        if (p.activeEaseVal === undefined && p.ease === undefined) return;

        const ease = parseFloat(p.activeEaseVal !== undefined ? p.activeEaseVal : p.ease);

        picksWithEase++;

        let cat = "Neutral Ease";
        if (ease >= 0.20) cat = "Positive Ease (>0.20)";
        else if (ease <= -0.20) cat = "Negative Ease (<-0.20)";

        easeBuckets[cat].total++;
        if (p.result === 'WIN') easeBuckets[cat].w++;
        else easeBuckets[cat].l++;

        // Contradiction Check
        const isContra = (p.side === 'OVER' && ease < -0.20) || (p.side === 'UNDER' && ease > 0.20);
        if (isContra) {
            contradictions.total++;
            if (p.result === 'WIN') contradictions.w++;
            else contradictions.l++;
        }
    });

    console.log(`\n🛡️ Win Rates by Ease (Sample: ${picksWithEase} picks with data):`);
    console.table(Object.entries(easeBuckets).map(([cat, data]) => ({
        "Ease Category": cat,
        "Win Rate": fmtPct(data.w, data.total),
        Volume: data.total
    })));

    console.log(`\n⚠️ Contradiction Plays (Betting AGAINST the Matchup):`);
    console.log(`   Record: ${contradictions.w}-${contradictions.l} (${fmtPct(contradictions.w, contradictions.total)})`);
    console.log(`   (Note: Low win rates here validate the "Negative Ease" penalty)`);

};

runAnalysis();

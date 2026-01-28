const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../history/prophet_history.json');

// ===== CONFIGURATION =====
const CONFIG = {
    // L5 Value Thresholds
    l5Positive: 1.0,    // Strong form threshold
    l5Negative: -1.0,   // Cold form threshold

    // Ease Thresholds  
    easePositive: 0.20,
    easeNegative: -0.20
};

// ===== HELPER FUNCTIONS =====
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

// ===== MAIN ANALYSIS =====
const runEnhancedAnalysis = () => {
    const history = loadHistory();
    const VALID_RESULTS = ['WIN', 'LOSS'];
    const validPicks = history.filter(p => VALID_RESULTS.includes(p.result));

    console.log(`\n📊 ENHANCED PROPHET CALIBRATION REPORT`);
    console.log(`======================================`);
    console.log(`Analyzing ${validPicks.length} settled picks...`);
    console.log(`Report Generated: ${new Date().toLocaleString()}\n`);

    // ===== 1. EASE IMPACT ANALYSIS =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📈 EASE MATCHUP IMPACT ANALYSIS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const easeBuckets = {
        "Positive Ease (≥0.20)": { w: 0, l: 0, total: 0 },
        "Neutral Ease": { w: 0, l: 0, total: 0 },
        "Negative Ease (≤-0.20)": { w: 0, l: 0, total: 0 }
    };

    // Contradiction Analysis (Betting Against Ease)
    const contradictions = {
        over_negEase: { w: 0, l: 0, total: 0 },  // OVER with negative ease
        under_posEase: { w: 0, l: 0, total: 0 }  // UNDER with positive ease
    };

    // Alignment Analysis (Betting With Ease)
    const alignment = {
        over_posEase: { w: 0, l: 0, total: 0 },  // OVER with positive ease
        under_negEase: { w: 0, l: 0, total: 0 }  // UNDER with negative ease
    };

    let picksWithEase = 0;

    validPicks.forEach(p => {
        // Handle multiple ease field names
        const ease = parseFloat(p.activeEaseVal !== undefined ? p.activeEaseVal :
            p.ease !== undefined ? p.ease :
                p.posEase);

        if (ease === undefined || isNaN(ease)) return;
        picksWithEase++;

        // Categorize Ease
        let cat = "Neutral Ease";
        if (ease >= CONFIG.easePositive) cat = "Positive Ease (≥0.20)";
        else if (ease <= CONFIG.easeNegative) cat = "Negative Ease (≤-0.20)";

        easeBuckets[cat].total++;
        if (p.result === 'WIN') easeBuckets[cat].w++;
        else easeBuckets[cat].l++;

        // Contradiction Detection
        if (p.side === 'OVER' && ease < CONFIG.easeNegative) {
            contradictions.over_negEase.total++;
            if (p.result === 'WIN') contradictions.over_negEase.w++;
            else contradictions.over_negEase.l++;
        }

        if (p.side === 'UNDER' && ease > CONFIG.easePositive) {
            contradictions.under_posEase.total++;
            if (p.result === 'WIN') contradictions.under_posEase.w++;
            else contradictions.under_posEase.l++;
        }

        // Alignment Detection
        if (p.side === 'OVER' && ease > CONFIG.easePositive) {
            alignment.over_posEase.total++;
            if (p.result === 'WIN') alignment.over_posEase.w++;
            else alignment.over_posEase.l++;
        }

        if (p.side === 'UNDER' && ease < CONFIG.easeNegative) {
            alignment.under_negEase.total++;
            if (p.result === 'WIN') alignment.under_negEase.w++;
            else alignment.under_negEase.l++;
        }
    });

    console.log(`🛡️ Win Rates by Ease Category (${picksWithEase} picks with data):`);
    console.table(Object.entries(easeBuckets).map(([cat, data]) => ({
        "Ease Category": cat,
        "Win Rate": fmtPct(data.w, data.total),
        Record: `${data.w}-${data.l}`,
        Volume: data.total
    })));

    console.log(`\n🎯 ALIGNMENT Analysis (Betting WITH Matchup):`);
    console.table([
        {
            "Type": "OVER + Positive Ease",
            "Record": `${alignment.over_posEase.w}-${alignment.over_posEase.l}`,
            "Win Rate": fmtPct(alignment.over_posEase.w, alignment.over_posEase.total),
            "Volume": alignment.over_posEase.total
        },
        {
            "Type": "UNDER + Negative Ease",
            "Record": `${alignment.under_negEase.w}-${alignment.under_negEase.l}`,
            "Win Rate": fmtPct(alignment.under_negEase.w, alignment.under_negEase.total),
            "Volume": alignment.under_negEase.total
        }
    ]);

    console.log(`\n⚠️ CONTRADICTION Analysis (Betting AGAINST Matchup):`);
    console.table([
        {
            "Type": "OVER + Negative Ease",
            "Record": `${contradictions.over_negEase.w}-${contradictions.over_negEase.l}`,
            "Win Rate": fmtPct(contradictions.over_negEase.w, contradictions.over_negEase.total),
            "Volume": contradictions.over_negEase.total,
            "Note": "High edge needed to overcome"
        },
        {
            "Type": "UNDER + Positive Ease",
            "Record": `${contradictions.under_posEase.w}-${contradictions.under_posEase.l}`,
            "Win Rate": fmtPct(contradictions.under_posEase.w, contradictions.under_posEase.total),
            "Volume": contradictions.under_posEase.total,
            "Note": "High edge needed to overcome"
        }
    ]);

    // ===== 2. L5 DATA ANALYSIS (Future Enhancement) =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔥 LAST 5 GAMES (L5) IMPACT ANALYSIS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const l5Buckets = {
        "Hot Form (≥1.0)": { w: 0, l: 0, total: 0 },
        "Neutral Form": { w: 0, l: 0, total: 0 },
        "Cold Form (≤-1.0)": { w: 0, l: 0, total: 0 }
    };

    const l5WithSide = {
        hot_over: { w: 0, l: 0, total: 0 },
        hot_under: { w: 0, l: 0, total: 0 },
        cold_over: { w: 0, l: 0, total: 0 },
        cold_under: { w: 0, l: 0, total: 0 }
    };

    let picksWithL5 = 0;

    validPicks.forEach(p => {
        // Check for L5 data (val_5, l5Val, or similar)
        const l5 = parseFloat(p.val_5 !== undefined ? p.val_5 :
            p.l5Val !== undefined ? p.l5Val :
                p.l5);

        if (l5 === undefined || isNaN(l5)) return;
        picksWithL5++;

        // Categorize L5
        let cat = "Neutral Form";
        if (l5 >= CONFIG.l5Positive) cat = "Hot Form (≥1.0)";
        else if (l5 <= CONFIG.l5Negative) cat = "Cold Form (≤-1.0)";

        l5Buckets[cat].total++;
        if (p.result === 'WIN') l5Buckets[cat].w++;
        else l5Buckets[cat].l++;

        // L5 + Side combinations
        if (l5 >= CONFIG.l5Positive && p.side === 'OVER') {
            l5WithSide.hot_over.total++;
            if (p.result === 'WIN') l5WithSide.hot_over.w++;
            else l5WithSide.hot_over.l++;
        }

        if (l5 >= CONFIG.l5Positive && p.side === 'UNDER') {
            l5WithSide.hot_under.total++;
            if (p.result === 'WIN') l5WithSide.hot_under.w++;
            else l5WithSide.hot_under.l++;
        }

        if (l5 <= CONFIG.l5Negative && p.side === 'OVER') {
            l5WithSide.cold_over.total++;
            if (p.result === 'WIN') l5WithSide.cold_over.w++;
            else l5WithSide.cold_over.l++;
        }

        if (l5 <= CONFIG.l5Negative && p.side === 'UNDER') {
            l5WithSide.cold_under.total++;
            if (p.result === 'WIN') l5WithSide.cold_under.w++;
            else l5WithSide.cold_under.l++;
        }
    });

    if (picksWithL5 > 0) {
        console.log(`📊 Win Rates by L5 Form (${picksWithL5} picks with data):`);
        console.table(Object.entries(l5Buckets).map(([cat, data]) => ({
            "Form Category": cat,
            "Win Rate": fmtPct(data.w, data.total),
            Record: `${data.w}-${data.l}`,
            Volume: data.total
        })));

        console.log(`\n🎯 L5 Form + Bet Direction Analysis:`);
        console.table([
            {
                "Type": "Hot Form + OVER",
                "Record": `${l5WithSide.hot_over.w}-${l5WithSide.hot_over.l}`,
                "Win Rate": fmtPct(l5WithSide.hot_over.w, l5WithSide.hot_over.total),
                "Volume": l5WithSide.hot_over.total,
                "Impact": "✅ Positive alignment"
            },
            {
                "Type": "Hot Form + UNDER",
                "Record": `${l5WithSide.hot_under.w}-${l5WithSide.hot_under.l}`,
                "Win Rate": fmtPct(l5WithSide.hot_under.w, l5WithSide.hot_under.total),
                "Volume": l5WithSide.hot_under.total,
                "Impact": "⚠️ Contradictory"
            },
            {
                "Type": "Cold Form + OVER",
                "Record": `${l5WithSide.cold_over.w}-${l5WithSide.cold_over.l}`,
                "Win Rate": fmtPct(l5WithSide.cold_over.w, l5WithSide.cold_over.total),
                "Volume": l5WithSide.cold_over.total,
                "Impact": "⚠️ Risky play"
            },
            {
                "Type": "Cold Form + UNDER",
                "Record": `${l5WithSide.cold_under.w}-${l5WithSide.cold_under.l}`,
                "Win Rate": fmtPct(l5WithSide.cold_under.w, l5WithSide.cold_under.total),
                "Volume": l5WithSide.cold_under.total,
                "Impact": "✅ Fade the slump"
            }
        ]);
    } else {
        console.log(`⚠️ No L5 data found in historical picks.`);
        console.log(`💡 To enable L5 analysis:`);
        console.log(`   1. Update server.js to include 'val_5' when publishing picks`);
        console.log(`   2. Update daily_workflow.js to log 'val_5' to history`);
        console.log(`   3. Data will accumulate for future analysis\n`);
    }

    // ===== 3. TIER PERFORMANCE =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🏆 WIN RATES BY TIER`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const tiers = {};
    validPicks.forEach(p => {
        const t = p.tier || 'Unknown';
        if (!tiers[t]) tiers[t] = { w: 0, l: 0, total: 0 };
        tiers[t].total++;
        if (p.result === 'WIN') tiers[t].w++;
        else tiers[t].l++;
    });

    console.table(Object.entries(tiers).map(([tier, data]) => ({
        Tier: tier,
        Record: `${data.w}-${data.l}`,
        "Win Rate": fmtPct(data.w, data.total),
        Volume: data.total
    })).sort((a, b) => parseFloat(b["Win Rate"]) - parseFloat(a["Win Rate"])));

    // ===== 4. KEY INSIGHTS =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💡 KEY INSIGHTS & RECOMMENDATIONS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Calculate Overall Alignment vs Contradiction Performance
    const totalAlignment = alignment.over_posEase.total + alignment.under_negEase.total;
    const winsAlignment = alignment.over_posEase.w + alignment.under_negEase.w;
    const totalContradiction = contradictions.over_negEase.total + contradictions.under_posEase.total;
    const winsContradiction = contradictions.over_negEase.w + contradictions.under_posEase.w;

    console.log(`📊 Alignment Strategy (Betting WITH ease):`);
    console.log(`   Record: ${winsAlignment}-${totalAlignment - winsAlignment} (${fmtPct(winsAlignment, totalAlignment)})`);
    console.log(`   Volume: ${totalAlignment} picks\n`);

    console.log(`⚠️ Contradiction Strategy (Betting AGAINST ease):`);
    console.log(`   Record: ${winsContradiction}-${totalContradiction - winsContradiction} (${fmtPct(winsContradiction, totalContradiction)})`);
    console.log(`   Volume: ${totalContradiction} picks\n`);

    // Performance difference
    const alignPct = (winsAlignment / totalAlignment) * 100;
    const contraPct = (winsContradiction / totalContradiction) * 100;
    const diff = alignPct - contraPct;

    if (diff > 5) {
        console.log(`✅ INSIGHT: Betting WITH ease improves win rate by ${diff.toFixed(1)}%`);
        console.log(`   → Consider increasing min edge requirements for contradiction plays\n`);
    } else if (diff < -5) {
        console.log(`⚠️ INSIGHT: Strong edge can overcome negative ease (${Math.abs(diff).toFixed(1)}% better)`);
        console.log(`   → Current penalty may be too harsh for high-edge plays\n`);
    } else {
        console.log(`📊 INSIGHT: Ease impact is neutral (${Math.abs(diff).toFixed(1)}% difference)`);
        console.log(`   → Edge is the primary driver; ease is secondary\n`);
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
};

// Run Analysis
runEnhancedAnalysis();

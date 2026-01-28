const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../history/prophet_history.json');

// ===== GRANULAR EASE TIER ANALYSIS =====
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

const runGranularEaseAnalysis = () => {
    const history = loadHistory();
    const VALID_RESULTS = ['WIN', 'LOSS'];
    const validPicks = history.filter(p => VALID_RESULTS.includes(p.result));

    console.log(`\n🔬 GRANULAR EASE TIER ANALYSIS`);
    console.log(`===============================`);
    console.log(`Analyzing ${validPicks.length} settled picks...`);
    console.log(`Report Generated: ${new Date().toLocaleString()}\n`);

    // ===== GRANULAR EASE TIERS =====
    const granularEaseTiers = {
        "Elite Position (≥0.60)": { w: 0, l: 0, total: 0 },
        "Strong Position (0.40-0.59)": { w: 0, l: 0, total: 0 },
        "Good Position (0.20-0.39)": { w: 0, l: 0, total: 0 },
        "Neutral (0.10 to -0.10)": { w: 0, l: 0, total: 0 },
        "Slight Disadvantage (-0.11 to -0.29)": { w: 0, l: 0, total: 0 },
        "Tough Matchup (-0.30 to -0.49)": { w: 0, l: 0, total: 0 },
        "Elite Defense (≤-0.50)": { w: 0, l: 0, total: 0 }
    };

    // Alignment Granular (OVER with Positive Ease tiers)
    const overWithPositiveEase = {
        "OVER + Elite (≥0.60)": { w: 0, l: 0, total: 0 },
        "OVER + Strong (0.40-0.59)": { w: 0, l: 0, total: 0 },
        "OVER + Good (0.20-0.39)": { w: 0, l: 0, total: 0 }
    };

    // Contradiction Granular (OVER with Negative Ease tiers)
    const overWithNegativeEase = {
        "OVER + Slight Neg (-0.11 to -0.29)": { w: 0, l: 0, total: 0 },
        "OVER + Tough (-0.30 to -0.49)": { w: 0, l: 0, total: 0 },
        "OVER + Elite Def (≤-0.50)": { w: 0, l: 0, total: 0 }
    };

    // Under Granular
    const underWithNegativeEase = {
        "UNDER + Slight Neg (-0.11 to -0.29)": { w: 0, l: 0, total: 0 },
        "UNDER + Tough (-0.30 to -0.49)": { w: 0, l: 0, total: 0 },
        "UNDER + Elite Def (≤-0.50)": { w: 0, l: 0, total: 0 }
    };

    let picksWithEase = 0;

    validPicks.forEach(p => {
        // Check for ease data (multiple field names)
        const ease = p.ease !== undefined ? parseFloat(p.ease) :
            p.posEase !== undefined ? parseFloat(p.posEase) :
                p.activeEaseVal !== undefined ? parseFloat(p.activeEaseVal) : null;

        if (ease === null || isNaN(ease)) return;
        picksWithEase++;

        // Categorize into granular tier
        let tier = "Neutral (0.10 to -0.10)";
        if (ease >= 0.60) tier = "Elite Position (≥0.60)";
        else if (ease >= 0.40) tier = "Strong Position (0.40-0.59)";
        else if (ease >= 0.20) tier = "Good Position (0.20-0.39)";
        else if (ease >= 0.10) tier = "Neutral (0.10 to -0.10)";
        else if (ease >= -0.10) tier = "Neutral (0.10 to -0.10)";
        else if (ease >= -0.29) tier = "Slight Disadvantage (-0.11 to -0.29)";
        else if (ease >= -0.49) tier = "Tough Matchup (-0.30 to -0.49)";
        else tier = "Elite Defense (≤-0.50)";

        granularEaseTiers[tier].total++;
        if (p.result === 'WIN') granularEaseTiers[tier].w++;
        else granularEaseTiers[tier].l++;

        // OVER with Positive Ease Breakdown
        if (p.side === 'OVER') {
            if (ease >= 0.60) {
                overWithPositiveEase["OVER + Elite (≥0.60)"].total++;
                if (p.result === 'WIN') overWithPositiveEase["OVER + Elite (≥0.60)"].w++;
                else overWithPositiveEase["OVER + Elite (≥0.60)"].l++;
            } else if (ease >= 0.40) {
                overWithPositiveEase["OVER + Strong (0.40-0.59)"].total++;
                if (p.result === 'WIN') overWithPositiveEase["OVER + Strong (0.40-0.59)"].w++;
                else overWithPositiveEase["OVER + Strong (0.40-0.59)"].l++;
            } else if (ease >= 0.20) {
                overWithPositiveEase["OVER + Good (0.20-0.39)"].total++;
                if (p.result === 'WIN') overWithPositiveEase["OVER + Good (0.20-0.39)"].w++;
                else overWithPositiveEase["OVER + Good (0.20-0.39)"].l++;
            } else if (ease < 0) {
                // OVER with Negative (Contradiction)
                if (ease >= -0.29) {
                    overWithNegativeEase["OVER + Slight Neg (-0.11 to -0.29)"].total++;
                    if (p.result === 'WIN') overWithNegativeEase["OVER + Slight Neg (-0.11 to -0.29)"].w++;
                    else overWithNegativeEase["OVER + Slight Neg (-0.11 to -0.29)"].l++;
                } else if (ease >= -0.49) {
                    overWithNegativeEase["OVER + Tough (-0.30 to -0.49)"].total++;
                    if (p.result === 'WIN') overWithNegativeEase["OVER + Tough (-0.30 to -0.49)"].w++;
                    else overWithNegativeEase["OVER + Tough (-0.30 to -0.49)"].l++;
                } else {
                    overWithNegativeEase["OVER + Elite Def (≤-0.50)"].total++;
                    if (p.result === 'WIN') overWithNegativeEase["OVER + Elite Def (≤-0.50)"].w++;
                    else overWithNegativeEase["OVER + Elite Def (≤-0.50)"].l++;
                }
            }
        }

        // UNDER with Negative Ease (Alignment)
        if (p.side === 'UNDER' && ease < 0) {
            if (ease >= -0.29) {
                underWithNegativeEase["UNDER + Slight Neg (-0.11 to -0.29)"].total++;
                if (p.result === 'WIN') underWithNegativeEase["UNDER + Slight Neg (-0.11 to -0.29)"].w++;
                else underWithNegativeEase["UNDER + Slight Neg (-0.11 to -0.29)"].l++;
            } else if (ease >= -0.49) {
                underWithNegativeEase["UNDER + Tough (-0.30 to -0.49)"].total++;
                if (p.result === 'WIN') underWithNegativeEase["UNDER + Tough (-0.30 to -0.49)"].w++;
                else underWithNegativeEase["UNDER + Tough (-0.30 to -0.49)"].l++;
            } else {
                underWithNegativeEase["UNDER + Elite Def (≤-0.50)"].total++;
                if (p.result === 'WIN') underWithNegativeEase["UNDER + Elite Def (≤-0.50)"].w++;
                else underWithNegativeEase["UNDER + Elite Def (≤-0.50)"].l++;
            }
        }
    });

    if (picksWithEase === 0) {
        console.log(`⚠️ No ease data found in historical picks.`);
        console.log(`💡 Ease data logging is now active. Run this analysis again after 1-2 weeks.\n`);
        return;
    }

    // ===== DISPLAY RESULTS =====
    console.log(`📊 Overall Ease Distribution (${picksWithEase} picks with data):\n`);
    console.table(Object.entries(granularEaseTiers)
        .map(([tier, data]) => ({
            "Ease Tier": tier,
            "Win Rate": fmtPct(data.w, data.total),
            Record: `${data.w}-${data.l}`,
            Volume: data.total
        }))
        .filter(row => row.Volume > 0));

    console.log(`\n✅ ALIGNMENT STRATEGY - OVER with Positive Ease Tiers:\n`);
    const overPosResults = Object.entries(overWithPositiveEase)
        .map(([tier, data]) => ({
            "Strategy": tier,
            "Win Rate": fmtPct(data.w, data.total),
            Record: `${data.w}-${data.l}`,
            Volume: data.total
        }))
        .filter(row => row.Volume > 0);

    if (overPosResults.length > 0) {
        console.table(overPosResults);

        // Calculate progression
        const elite = overWithPositiveEase["OVER + Elite (≥0.60)"];
        const strong = overWithPositiveEase["OVER + Strong (0.40-0.59)"];
        const good = overWithPositiveEase["OVER + Good (0.20-0.39)"];

        console.log(`💡 INSIGHT: Does higher ease → higher win rate?`);
        if (elite.total > 0) console.log(`   Elite (≥0.60): ${fmtPct(elite.w, elite.total)} (${elite.w}-${elite.l})`);
        if (strong.total > 0) console.log(`   Strong (0.40-0.59): ${fmtPct(strong.w, strong.total)} (${strong.w}-${strong.l})`);
        if (good.total > 0) console.log(`   Good (0.20-0.39): ${fmtPct(good.w, good.total)} (${good.w}-${good.l})`);
    } else {
        console.log(`No OVER + Positive Ease picks yet.`);
    }

    console.log(`\n⚠️ CONTRADICTION STRATEGY - OVER with Negative Ease Tiers:\n`);
    const overNegResults = Object.entries(overWithNegativeEase)
        .map(([tier, data]) => ({
            "Strategy": tier,
            "Win Rate": fmtPct(data.w, data.total),
            Record: `${data.w}-${data.l}`,
            Volume: data.total,
            "Risk": data.total > 0 ? (data.w / data.total < 0.55 ? "🔴 Avoid" : "🟡 Needs high edge") : "N/A"
        }))
        .filter(row => row.Volume > 0);

    if (overNegResults.length > 0) {
        console.table(overNegResults);
    } else {
        console.log(`No OVER + Negative Ease picks yet.`);
    }

    console.log(`\n✅ ALIGNMENT STRATEGY - UNDER with Negative Ease Tiers:\n`);
    const underNegResults = Object.entries(underWithNegativeEase)
        .map(([tier, data]) => ({
            "Strategy": tier,
            "Win Rate": fmtPct(data.w, data.total),
            Record: `${data.w}-${data.l}`,
            Volume: data.total
        }))
        .filter(row => row.Volume > 0);

    if (underNegResults.length > 0) {
        console.table(underNegResults);
    } else {
        console.log(`No UNDER + Negative Ease picks yet.`);
    }

    // ===== KEY INSIGHTS =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💡 CALIBRATION RECOMMENDATIONS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Check if there's a progression (higher ease = higher win rate)
    const elite = overWithPositiveEase["OVER + Elite (≥0.60)"];
    const strong = overWithPositiveEase["OVER + Strong (0.40-0.59)"];
    const good = overWithPositiveEase["OVER + Good (0.20-0.39)"];

    if (elite.total >= 5 && strong.total >= 5 && good.total >= 5) {
        const eliteWR = elite.w / elite.total;
        const strongWR = strong.w / strong.total;
        const goodWR = good.w / good.total;

        if (eliteWR > strongWR && strongWR > goodWR) {
            const diff = ((eliteWR - goodWR) * 100).toFixed(1);
            console.log(`✅ VALIDATED: Higher ease correlates with higher win rate`);
            console.log(`   Elite Ease wins ${diff}% more often than Good Ease`);
            console.log(`   → Current ease bonuses are well-calibrated\n`);
        } else {
            console.log(`⚠️ UNEXPECTED: Win rates don't increase linearly with ease`);
            console.log(`   → May need to adjust ease bonus formula\n`);
        }
    } else {
        console.log(`⏳ Insufficient data for tier progression analysis`);
        console.log(`   Need 5+ picks per tier (currently: Elite=${elite.total}, Strong=${strong.total}, Good=${good.total})\n`);
    }

    console.log(`📊 Sample Size Guidelines:`);
    console.log(`   • 30+ picks per tier: Initial insights`);
    console.log(`   • 50+ picks per tier: Reliable trends`);
    console.log(`   • 100+ picks per tier: Statistical significance\n`);
};

runGranularEaseAnalysis();

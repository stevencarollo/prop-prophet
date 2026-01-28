const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../history/prophet_history.json');

// ===== FEATURE IMPORTANCE ANALYSIS =====
// Goal: Identify which model components most impact winning picks

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

const runFeatureImportanceAnalysis = () => {
    const history = loadHistory();
    const VALID_RESULTS = ['WIN', 'LOSS'];
    const validPicks = history.filter(p => VALID_RESULTS.includes(p.result));

    console.log(`\n🔬 MODEL FEATURE IMPORTANCE ANALYSIS`);
    console.log(`====================================`);
    console.log(`Analyzing ${validPicks.length} settled picks...`);
    console.log(`Goal: Identify which model components most impact wins\n`);

    // ===== 1. TIER ANALYSIS (CONFIDENCE SCORING) =====
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 TIER PERFORMANCE (Model's Confidence Rating)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const tiers = {};
    validPicks.forEach(p => {
        const t = p.tier || 'Unknown';
        if (!tiers[t]) tiers[t] = { w: 0, l: 0, total: 0, roi: [] };
        tiers[t].total++;
        if (p.result === 'WIN') {
            tiers[t].w++;
            tiers[t].roi.push(1); // Win = +1 unit
        } else {
            tiers[t].l++;
            tiers[t].roi.push(-1.1); // Loss = -1.1 units (juice)
        }
    });

    const tierResults = Object.entries(tiers)
        .map(([tier, data]) => {
            const wr = (data.w / data.total) * 100;
            const roi = data.roi.reduce((sum, v) => sum + v, 0);
            const roiPct = (roi / data.total) * 100;
            return {
                Tier: tier,
                Record: `${data.w}-${data.l}`,
                "Win %": fmtPct(data.w, data.total),
                Volume: data.total,
                "ROI": roiPct >= 0 ? `+${roiPct.toFixed(1)}%` : `${roiPct.toFixed(1)}%`,
                "_wr": wr
            };
        })
        .sort((a, b) => b._wr - a._wr);

    console.table(tierResults.map(r => ({ ...r, _wr: undefined })));

    console.log(`💡 INSIGHT: If tiers are well-calibrated:`);
    console.log(`   • Locks should have 75%+ win rate`);
    console.log(`   • Each tier drop should show 5-10% decrease in win rate`);
    console.log(`   • All tiers should be profitable (ROI > -5%)\n`);

    // Calibration Check
    const lockWR = tiers['🔒 PROPHET LOCK'] ? (tiers['🔒 PROPHET LOCK'].w / tiers['🔒 PROPHET LOCK'].total) * 100 : 0;
    const solidWR = tiers['✅ SOLID PLAY'] ? (tiers['✅ SOLID PLAY'].w / tiers['✅ SOLID PLAY'].total) * 100 : 0;
    const spread = lockWR - solidWR;

    if (spread > 20) {
        console.log(`✅ EXCELLENT CALIBRATION: ${spread.toFixed(1)}% spread between Locks and Solid Plays`);
    } else if (spread > 10) {
        console.log(`✅ GOOD CALIBRATION: ${spread.toFixed(1)}% spread between Locks and Solid Plays`);
    } else {
        console.log(`⚠️ NEEDS TUNING: Only ${spread.toFixed(1)}% spread between Locks and Solid Plays`);
        console.log(`   → Consider tightening Lock criteria or loosening Solid criteria\n`);
    }

    // ===== 2. STAT TYPE PERFORMANCE =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🏀 STAT TYPE PERFORMANCE (What Props Work Best)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const stats = {};
    validPicks.forEach(p => {
        const s = (p.stat || 'Unknown').toUpperCase();
        if (!stats[s]) stats[s] = { w: 0, l: 0, total: 0 };
        stats[s].total++;
        if (p.result === 'WIN') stats[s].w++;
        else stats[s].l++;
    });

    const statResults = Object.entries(stats)
        .map(([stat, data]) => ({
            Stat: stat,
            Record: `${data.w}-${data.l}`,
            "Win %": fmtPct(data.w, data.total),
            Volume: data.total,
            "_wr": (data.w / data.total) * 100
        }))
        .sort((a, b) => b._wr - a._wr);

    console.table(statResults.map(r => ({ ...r, _wr: undefined })));

    console.log(`💡 INSIGHT: This shows if model performs better on certain prop types`);
    console.log(`   • High win rate + high volume = sweet spot`);
    console.log(`   • Low win rate + high volume = adjust scoring for that stat\n`);

    // ===== 3. SIDE ANALYSIS (OVER vs UNDER) =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⚖️ SIDE BIAS (Over vs Under Performance)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const sides = { "OVER": { w: 0, l: 0, total: 0 }, "UNDER": { w: 0, l: 0, total: 0 } };
    validPicks.forEach(p => {
        const side = p.side || "OVER";
        if (!sides[side]) sides[side] = { w: 0, l: 0, total: 0 };
        sides[side].total++;
        if (p.result === 'WIN') sides[side].w++;
        else sides[side].l++;
    });

    console.table(Object.entries(sides).map(([side, data]) => ({
        Side: side,
        Record: `${data.w}-${data.l}`,
        "Win %": fmtPct(data.w, data.total),
        Volume: data.total,
        "% of Picks": fmtPct(data.total, validPicks.length)
    })));

    const overWR = (sides.OVER.w / sides.OVER.total) * 100;
    const underWR = (sides.UNDER.w / sides.UNDER.total) * 100;
    const bias = Math.abs(overWR - underWR);

    if (bias > 10) {
        console.log(`\n⚠️ SIGNIFICANT SIDE BIAS: ${bias.toFixed(1)}% difference`);
        console.log(`   → Model may be over/under-weighting certain factors for one side`);
    } else {
        console.log(`\n✅ BALANCED PERFORMANCE: Only ${bias.toFixed(1)}% difference between sides`);
    }

    // ===== 4. EDGE ANALYSIS (if available) =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📈 EDGE ANALYSIS (Projection vs Line Impact)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const edgeBuckets = {
        "Massive (≥5.0)": { w: 0, l: 0, total: 0 },
        "Large (3.0-4.9)": { w: 0, l: 0, total: 0 },
        "Medium (1.5-2.9)": { w: 0, l: 0, total: 0 },
        "Small (<1.5)": { w: 0, l: 0, total: 0 }
    };

    let picksWithEdge = 0;
    validPicks.forEach(p => {
        const edge = p.edge !== undefined ? parseFloat(p.edge) : null;
        if (edge === null || isNaN(edge)) return;

        picksWithEdge++;

        let bucket = "Small (<1.5)";
        if (edge >= 5.0) bucket = "Massive (≥5.0)";
        else if (edge >= 3.0) bucket = "Large (3.0-4.9)";
        else if (edge >= 1.5) bucket = "Medium (1.5-2.9)";

        edgeBuckets[bucket].total++;
        if (p.result === 'WIN') edgeBuckets[bucket].w++;
        else edgeBuckets[bucket].l++;
    });

    if (picksWithEdge > 0) {
        console.table(Object.entries(edgeBuckets)
            .filter(([, data]) => data.total > 0)
            .map(([bucket, data]) => ({
                "Edge Size": bucket,
                Record: `${data.w}-${data.l}`,
                "Win %": fmtPct(data.w, data.total),
                Volume: data.total
            })));

        console.log(`\n💡 INSIGHT: This shows if larger edges actually win more`);
        console.log(`   • Should see increasing win rates with larger edges`);
        console.log(`   • If not, edge might be overweighted in scoring\n`);
    } else {
        console.log(`⚠️ No edge data in historical picks (will be available going forward)\n`);
    }

    // ===== 5. COMPREHENSIVE FEATURE RANKING =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🏆 FEATURE IMPORTANCE RANKING`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const features = [];

    // 1. Tier (Confidence) Impact
    const tierSpread = lockWR - solidWR;
    features.push({
        Feature: "Tier/Confidence",
        Impact: tierSpread > 20 ? "🔴 CRITICAL" : tierSpread > 10 ? "🟠 HIGH" : "🟡 MODERATE",
        "Win Rate Spread": `${tierSpread.toFixed(1)}%`,
        "Data Quality": tiers['🔒 PROPHET LOCK'] && tiers['🔒 PROPHET LOCK'].total >= 10 ? "✅ Good" : "⚠️ Low Sample",
        Insight: "Overall model confidence calibration"
    });

    // 2. Stat Type Impact
    const topStat = statResults[0];
    const bottomStat = statResults[statResults.length - 1];
    const statSpread = topStat._wr - bottomStat._wr;
    features.push({
        Feature: "Stat Type",
        Impact: statSpread > 30 ? "🟠 HIGH" : statSpread > 15 ? "🟡 MODERATE" : "🟢 LOW",
        "Win Rate Spread": `${statSpread.toFixed(1)}%`,
        "Data Quality": topStat.Volume >= 10 ? "✅ Good" : "⚠️ Low Sample",
        Insight: `${topStat.Stat} performs best (${topStat["Win %"]})`
    });

    // 3. Side Bias
    features.push({
        Feature: "Side (Over/Under)",
        Impact: bias > 15 ? "🟠 HIGH" : bias > 8 ? "🟡 MODERATE" : "🟢 LOW",
        "Win Rate Spread": `${bias.toFixed(1)}%`,
        "Data Quality": "✅ Good",
        Insight: overWR > underWR ? `Overs outperform by ${bias.toFixed(1)}%` : `Unders outperform by ${bias.toFixed(1)}%`
    });

    // 4. Edge (if available)
    if (picksWithEdge >= 30) {
        const massiveEdge = edgeBuckets["Massive (≥5.0)"];
        const smallEdge = edgeBuckets["Small (<1.5)"];
        if (massiveEdge.total >= 5 && smallEdge.total >= 5) {
            const edgeSpread = ((massiveEdge.w / massiveEdge.total) - (smallEdge.w / smallEdge.total)) * 100;
            features.push({
                Feature: "Edge Size",
                Impact: edgeSpread > 20 ? "🔴 CRITICAL" : edgeSpread > 10 ? "🟠 HIGH" : "🟡 MODERATE",
                "Win Rate Spread": `${edgeSpread.toFixed(1)}%`,
                "Data Quality": "✅ Good",
                Insight: "Larger projection advantages win more"
            });
        }
    }

    // 5. Ease (placeholder for future)
    features.push({
        Feature: "Ease (Matchup)",
        Impact: "⏳ PENDING",
        "Win Rate Spread": "N/A",
        "Data Quality": "⏳ Accumulating",
        Insight: "Data logging started today"
    });

    // 6. L5 Form (placeholder for future)
    features.push({
        Feature: "L5 (Recent Form)",
        Impact: "⏳ PENDING",
        "Win Rate Spread": "N/A",
        "Data Quality": "⏳ Accumulating",
        Insight: "Data logging started today"
    });

    console.table(features);

    // ===== 6. ACTIONABLE RECOMMENDATIONS =====
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💡 ACTIONABLE RECOMMENDATIONS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const recommendations = [];

    // Check tier calibration
    if (tierSpread < 15) {
        recommendations.push("⚠️ TIER CALIBRATION: Increase Prophet Lock threshold or reduce Solid Play threshold");
    }
    if (tiers['🔥 ELITE'] && (tiers['🔥 ELITE'].w / tiers['🔥 ELITE'].total) < 0.50) {
        recommendations.push("⚠️ ELITE TIER UNDERPERFORMING: Consider removing this tier or raising bar");
    }

    // Check stat type performance
    if (statSpread > 40) {
        recommendations.push(`⚠️ STAT INCONSISTENCY: ${topStat.Stat} performs well (${topStat["Win %"]}) but ${bottomStat.Stat} struggles (${bottomStat["Win %"]}). Review scoring weights.`);
    }

    // Check volume distribution
    const lowVolumeTiers = tierResults.filter(t => t.Volume < 5 && !t.Tier.includes('Unknown'));
    if (lowVolumeTiers.length > 0) {
        recommendations.push(`📊 LOW VOLUME TIERS: ${lowVolumeTiers.map(t => t.Tier).join(', ')} have <5 picks. Consider consolidating.`);
    }

    // Check side bias
    if (bias > 12) {
        recommendations.push(`⚖️ SIDE BIAS: ${overWR > underWR ? 'Overs' : 'Unders'} performing ${bias.toFixed(1)}% better. Review if scoring factors favor one side.`);
    }

    if (recommendations.length === 0) {
        console.log(`✅ MODEL PERFORMING WELL: No major calibration issues detected`);
        console.log(`   Continue monitoring as more data accumulates\n`);
    } else {
        recommendations.forEach((r, i) => console.log(`${i + 1}. ${r}`));
        console.log('');
    }

    console.log(`📊 Next Steps:`);
    console.log(`   1. Run this analysis weekly as ease/L5 data accumulates`);
    console.log(`   2. Once 50+ picks with ease data: Analyze ease tier impact`);
    console.log(`   3. Once 100+ picks with L5 data: Analyze form correlation`);
    console.log(`   4. Use insights to fine-tune scoring weights in server.js\n`);
};

runFeatureImportanceAnalysis();

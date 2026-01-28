const fs = require('fs');
const path = require('path');

// Read latest_picks.js as text and extract LATEST_PICKS array
const picksFile = path.join(__dirname, '../latest_picks.js');
const content = fs.readFileSync(picksFile, 'utf8');

// Extract the LATEST_PICKS array (it's assigned to window.LATEST_PICKS)
const match = content.match(/window\.LATEST_PICKS\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
    console.error('Could not find LATEST_PICKS in file');
    process.exit(1);
}

const picks = JSON.parse(match[1]);

console.log(`\n📊 CURRENT PICKS EASE ANALYSIS`);
console.log(`==============================`);
console.log(`Total Picks: ${picks.length}\n`);

// Categorize by ease tiers
const tiers = {
    "Elite+ (≥0.60)": [],
    "Strong (0.40-0.59)": [],
    "Good (0.20-0.39)": [],
    "Neutral (0.10 to -0.10)": [],
    "Slight Neg (-0.11 to -0.29)": [],
    "Tough (-0.30 to -0.49)": [],
    "Elite Defense (≤-0.50)": []
};

const alignmentPicks = [];
const contradictionPicks = [];

picks.forEach(p => {
    const ease = p.ease || p.posEase || 0;

    // Categorize
    let tier = "Neutral (0.10 to -0.10)";
    if (ease >= 0.60) tier = "Elite+ (≥0.60)";
    else if (ease >= 0.40) tier = "Strong (0.40-0.59)";
    else if (ease >= 0.20) tier = "Good (0.20-0.39)";
    else if (ease >= 0.10) tier = "Neutral (0.10 to -0.10)";
    else if (ease >= -0.10) tier = "Neutral (0.10 to -0.10)";
    else if (ease >= -0.29) tier = "Slight Neg (-0.11 to -0.29)";
    else if (ease >= -0.49) tier = "Tough (-0.30 to -0.49)";
    else tier = "Elite Defense (≤-0.50)";

    tiers[tier].push({
        player: p.player,
        stat: p.stat,
        side: p.side,
        ease: ease,
        posEase: p.posEase,
        teamEase: p.teamEase,
        tier: p.betRating,
        score: parseFloat(p.score)
    });

    // Check alignment vs contradiction
    if ((p.side === 'OVER' && ease > 0.20) || (p.side === 'UNDER' && ease < -0.20)) {
        alignmentPicks.push({ player: p.player, stat: p.stat, side: p.side, ease: ease, tier: p.betRating });
    } else if ((p.side === 'OVER' && ease < -0.20) || (p.side === 'UNDER' && ease > 0.20)) {
        contradictionPicks.push({ player: p.player, stat: p.stat, side: p.side, ease: ease, tier: p.betRating });
    }
});

// Display breakdown
console.log(`📈 EASE TIER DISTRIBUTION:\n`);
Object.entries(tiers).forEach(([tier, pickList]) => {
    if (pickList.length > 0) {
        const avgScore = (pickList.reduce((sum, p) => sum + p.score, 0) / pickList.length).toFixed(2);
        console.log(`${tier}: ${pickList.length} picks (Avg Score: ${avgScore})`);

        // Show top 3 picks in this tier
        const top3 = pickList.sort((a, b) => b.score - a.score).slice(0, 3);
        top3.forEach(p => {
            console.log(`  • ${p.player} ${p.stat.toUpperCase()} ${p.side} (Ease: ${p.ease.toFixed(2)}, ${p.tier}, Score: ${p.score})`);
        });
        console.log('');
    }
});

// Alignment Analysis
console.log(`\n✅ ALIGNMENT PICKS (Betting WITH Ease): ${alignmentPicks.length} picks`);
if (alignmentPicks.length > 0) {
    console.log(`   Avg Ease: ${(alignmentPicks.reduce((sum, p) => sum + Math.abs(p.ease), 0) / alignmentPicks.length).toFixed(2)}`);
    console.log(`   Breakdown:`);

    // Group by ease magnitude
    const highEase = alignmentPicks.filter(p => Math.abs(p.ease) >= 0.40);
    const medEase = alignmentPicks.filter(p => Math.abs(p.ease) >= 0.20 && Math.abs(p.ease) < 0.40);

    if (highEase.length > 0) {
        console.log(`   • High Ease (≥0.40): ${highEase.length} picks`);
        highEase.slice(0, 5).forEach(p => {
            console.log(`     - ${p.player} ${p.stat.toUpperCase()} ${p.side} (Ease: ${p.ease.toFixed(2)})`);
        });
    }
    if (medEase.length > 0) {
        console.log(`   • Medium Ease (0.20-0.39): ${medEase.length} picks`);
    }
}

// Contradiction Analysis
console.log(`\n⚠️ CONTRADICTION PICKS (Betting AGAINST Ease): ${contradictionPicks.length} picks`);
if (contradictionPicks.length > 0) {
    console.log(`   Avg Ease: ${(contradictionPicks.reduce((sum, p) => sum + p.ease, 0) / contradictionPicks.length).toFixed(2)}`);
    contradictionPicks.slice(0, 5).forEach(p => {
        console.log(`   • ${p.player} ${p.stat.toUpperCase()} ${p.side} (Ease: ${p.ease.toFixed(2)}, ${p.tier})`);
    });
}

// Key Question: Does higher ease appear in higher tiers?
console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`💡 INSIGHT: Does Higher Ease → Higher Confidence/Tier?`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const locks = picks.filter(p => p.betRating.includes('LOCK'));
const diamonds = picks.filter(p => p.betRating.includes('DIAMOND'));
const elite = picks.filter(p => p.betRating.includes('ELITE'));
const strong = picks.filter(p => p.betRating.includes('STRONG'));
const solid = picks.filter(p => p.betRating.includes('SOLID'));

const calcAvgEase = (pickList) => {
    if (pickList.length === 0) return 0;
    return pickList.reduce((sum, p) => sum + (p.ease || p.posEase || 0), 0) / pickList.length;
};

console.log(`Prophet Locks (${locks.length}): Avg Ease = ${calcAvgEase(locks).toFixed(3)}`);
console.log(`Diamond Boy (${diamonds.length}): Avg Ease = ${calcAvgEase(diamonds).toFixed(3)}`);
console.log(`Elite (${elite.length}): Avg Ease = ${calcAvgEase(elite).toFixed(3)}`);
console.log(`Strong Play (${strong.length}): Avg Ease = ${calcAvgEase(strong).toFixed(3)}`);
console.log(`Solid Play (${solid.length}): Avg Ease = ${calcAvgEase(solid).toFixed(3)}`);

console.log(`\n📊 This shows whether the model is already rewarding higher ease with higher tiers.`);
console.log(`   If Locks have higher avg ease than Solid plays, the calibration is working.\n`);

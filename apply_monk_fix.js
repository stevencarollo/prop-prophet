const fs = require('fs');
const path = require('path');

const historyPath = path.join(__dirname, 'history', 'prophet_history.json');
const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

let updatedCount = 0;
history.forEach(h => {
    // Identify Malik Monk picks from Jan 21
    if (h.player === 'Malik Monk' && h.date === '2026-01-21' && h.tier.includes('DIAMOND')) {
        h.tier = '🔒 PROPHET LOCK';
        updatedCount++;
    }
});

if (updatedCount > 0) {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    console.log(`Updated ${updatedCount} Monk picks to LOCK.`);
}

// Recalculate Stats immediately
function generateStats(history) {
    const stats = {
        season: { w: 0, l: 0, p: 0, total: 0, pct: 0 },
        locks: { w: 0, l: 0, p: 0, total: 0, pct: 0 },
        diamond: { w: 0, l: 0, p: 0, total: 0, pct: 0 },
        elite: { w: 0, l: 0, p: 0, total: 0, pct: 0 }
    };

    history.forEach(h => {
        if (h.result === 'PENDING' || h.result === 'PUSH') return;

        if (h.result === 'WIN') stats.season.w++;
        if (h.result === 'LOSS') stats.season.l++;

        let tierKey = null;
        if (h.tier.includes('LOCK')) tierKey = 'locks';
        if (h.tier.includes('DIAMOND')) tierKey = 'diamond';
        if (h.tier.includes('ELITE')) tierKey = 'elite';

        if (tierKey) {
            if (h.result === 'WIN') stats[tierKey].w++;
            if (h.result === 'LOSS') stats[tierKey].l++;
        }
    });

    const calc = (obj) => {
        obj.total = obj.w + obj.l;
        obj.pct = obj.total > 0 ? Math.round((obj.w / obj.total) * 100) : 0;
    };
    calc(stats.season);
    calc(stats.locks);
    calc(stats.diamond);
    calc(stats.elite);
    return stats;
}

const newStats = generateStats(history);
console.log(JSON.stringify(newStats, null, 2));

// Update latest_picks.js
const latestPicksPath = path.join(__dirname, 'latest_picks.js');
let content = fs.readFileSync(latestPicksPath, 'utf8');
const recordRegex = /window\.PROPHET_RECORD\s*=\s*\{[\s\S]*?\};/;
const newRecordStr = `window.PROPHET_RECORD = ${JSON.stringify(newStats, null, 4)};`;

if (recordRegex.test(content)) {
    content = content.replace(recordRegex, newRecordStr);
    fs.writeFileSync(latestPicksPath, content);
    console.log('Updated latest_picks.js with new stats.');
}

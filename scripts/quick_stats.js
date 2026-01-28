const fs = require('fs');
const path = require('path');

const histFile = path.join(__dirname, '../history/prophet_history.json');
const history = JSON.parse(fs.readFileSync(histFile, 'utf8'));

const today = "2026-01-22"; // Checking YESTERDAY
const target = history.filter(h => h.date === today);

console.log(`Total Picks for ${today}: ${target.length}`);

const stats = { RESOLVED: 0, PENDING: 0 };

target.forEach(h => {
    if (h.result === 'PENDING') stats.PENDING++;
    else stats.RESOLVED++;
});

console.log(JSON.stringify(stats, null, 2));

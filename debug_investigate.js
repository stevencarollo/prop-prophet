const fs = require('fs');
const path = require('path');

const historyPath = path.join(__dirname, 'history', 'prophet_history.json');
const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

const players = ['Aaron Gordon', 'Peyton Watson'];
const picks = history.filter(h => players.includes(h.player));

console.log('--- Picks for Gordon and Watson ---');
picks.forEach(p => {
    console.log(JSON.stringify(p, null, 2));
});

// Check games for 2026-01-20 via BBM or just hardcoded knowledge check isn't possible, 
// so we will trust the user or check if there are OTHER resolved picks for DEN on Jan 20.
const denPicksJan20 = history.filter(h => h.team === 'DEN' && h.date === '2026-01-20');
console.log(`\n--- DEN Picks for 2026-01-20: ${denPicksJan20.length} ---`);
denPicksJan20.forEach(p => console.log(`${p.player} - ${p.result}`));

const denPicksJan21 = history.filter(h => h.team === 'DEN' && h.date === '2026-01-21');
console.log(`\n--- DEN Picks for 2026-01-21: ${denPicksJan21.length} ---`);
denPicksJan21.forEach(p => console.log(`${p.player} - ${p.result}`));

const denPicksJan22 = history.filter(h => h.team === 'DEN' && h.date === '2026-01-22');
console.log(`\n--- DEN Picks for 2026-01-22: ${denPicksJan22.length} ---`);
denPicksJan22.forEach(p => console.log(`${p.player} - ${p.result}`));

const fs = require('fs');
const history = JSON.parse(fs.readFileSync('./history/prophet_history.json', 'utf8'));

const rPicks = history.filter(p => p.stat === 'r');
const bigEdges = rPicks.filter(p => parseFloat(p.edge) >= 1.5); // Lowered slightly to capture more

console.log(`Total Rebound Picks in History: ${rPicks.length}`);
console.log(`Rebound Picks with Edge >= 1.5: ${bigEdges.length}`);
console.log(`Win Rate on Big Edges: ${bigEdges.filter(p => p.result === 'WIN').length} Wins / ${bigEdges.filter(p => p.result === 'WIN' || p.result === 'LOSS').length} Total`);
console.log('--- Samples ---');
bigEdges.slice(0, 5).forEach(p => console.log(`${p.player} (${p.side} ${p.line}): Edge ${p.edge} -> ${p.result}`));

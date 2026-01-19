const fs = require('fs');
const path = require('path');

const CHUNKS = [
    'ease_raw_chunk1.txt',
    'ease_raw_chunk2.txt',
    'ease_raw_chunk3.txt'
];

const OUTPUT_FILE = 'ease_rankings.json';

function parse() {
    let combined = '';
    for (const chunk of CHUNKS) {
        if (fs.existsSync(chunk)) {
            combined += fs.readFileSync(chunk, 'utf8') + '\n';
        }
    }

    const lines = combined.split('\n');

    const db = {}; // { Position: { Timeframe: { Team: { stats... } } } }

    let currentPos = null;
    let currentTime = null;

    // Helper to normalize team names (e.g. "vs MEM" -> "MEM")
    const normTeam = (t) => t.replace('vs ', '').trim();

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // Detect Timeframe
        if (line.includes('Past 1 Week')) currentTime = '1w';
        if (line.includes('Past 2 Weeks')) currentTime = '2w';
        if (line.includes('Full Season')) currentTime = 'season';

        // Detect Position
        // Format: "Ease for Selected Position [POS]"
        // Or if the line matches specifically "Ease for Selected Position" and next line is POS?
        // User text: "Ease for Selected Position \n PG" or inline.
        // Let's look for known positions in context lines.
        if (line.includes('Ease for Selected Position')) {
            // Check if position is on this line?
            // Usually it's underneath in the raw paste, or end of line.
            // Let's peep next lines or check simply if the line is JUST a position like "PG"
        }

        // Explicitly check for position lines (often short, uppercase)
        if (['All', 'PG', 'SG', 'SF', 'PF', 'C'].includes(line)) {
            currentPos = line;
            continue;
        }

        // Logic check: if we see "vs Team", it's a header row
        if (line.startsWith('vs Team')) continue;

        // Data Row: starts with "vs [AAA]"
        if (line.startsWith('vs ')) {
            if (!currentPos || !currentTime) {
                // console.log('Skipping row (no context):', line); 
                continue;
            }

            // Split by whitespace
            // vs MEM	1.15	1.79	1.91	1.20	1.33	1.18	0.78	0.39	1.59
            // indices: 0:TeamName(vs+Team), 1:Value, 2:pV, 3:3V, 4:rV, 5:aV, 6:sV, 7:bV, 8:fg%V, 9:toV

            // Handle "vs MEM" as two tokens or one? 
            // Normalize: remove "vs " first?
            // "vs MEM 1.15 ..." -> "MEM 1.15 ..."

            const cleanLine = line.replace('vs ', '').trim();
            const parts = cleanLine.split(/\s+/); // Split by any whitespace (tab or space)

            // parts[0] is Team (e.g. MEM)
            // parts[1] is Value
            // parts[2] is pV
            // ...

            const team = parts[0];

            // Map values
            // p=pts, 3=3pt, r=reb, a=ast, s=stl, b=blk, to=to
            // data order: Value, pV, 3V, rV, aV, sV, bV, fg%V, toV

            const stats = {
                val: parseFloat(parts[1]),
                pts: parseFloat(parts[2]),
                threes: parseFloat(parts[3]),
                reb: parseFloat(parts[4]),
                ast: parseFloat(parts[5]),
                stl: parseFloat(parts[6]),
                blk: parseFloat(parts[7]),
                to: parseFloat(parts[9]) // Index 9 is TO value? 
                // Wait, count carefully:
                // 0:Team, 1:Val, 2:p, 3:3, 4:r, 5:a, 6:s, 7:b, 8:fg, 9:to
            };

            if (!db[currentPos]) db[currentPos] = {};
            if (!db[currentPos][currentTime]) db[currentPos][currentTime] = {};

            db[currentPos][currentTime][team] = stats;
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(db, null, 2));
    console.log('Processed ease data. Saved to', OUTPUT_FILE);

    // Quick validation log
    console.log('Positions found:', Object.keys(db));
    if (db['PG']) console.log('PG Timeframes:', Object.keys(db['PG']));
}

parse();

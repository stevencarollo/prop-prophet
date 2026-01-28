const puppeteer = require('puppeteer');

// --- MOCK DATA & HELPERS ---
const PLAYER_NAME = "PJ Washington";
const STAT = "pr";
const LINE = 21;
const SIDE = "OVER";

// Log fetcher (from daily_workflow.js)
async function fetchGameLogs(browser) {
    console.log('📅 Fetching Game Logs...');
    const logs = {};
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    const formatDate = (date) => {
        const d = new Date(date);
        return {
            M: d.getMonth() + 1,
            D: d.getDate(),
            Y: d.getFullYear(),
            str: d.toISOString().split('T')[0]
        };
    };

    const today = new Date();
    // Only need last few days to find PJ Washington games
    // PJ played on: Jan 20, Jan 15, Jan 14...
    // Let's go back 14 days just like real script
    for (let i = 1; i <= 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const { M, D, Y, str } = formatDate(d);
        const url = `https://www.basketball-reference.com/friv/dailyleaders.fcgi?month=${M}&day=${D}&year=${Y}`;

        try {
            console.log(`   > Fetching logs for ${str}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // Fast fail if not PJ Washington? No, we need to replicate script

            const dailyStats = await page.evaluate((dateStr) => {
                const table = document.querySelector('#stats') || document.querySelector('.stats_table') || document.querySelector('table');
                if (!table) return [];

                const rows = Array.from(table.querySelectorAll('tbody tr'));
                const results = [];
                rows.forEach(row => {
                    if (row.classList.contains('thead')) return;
                    const nameEl = row.querySelector('td[data-stat="player"] a');
                    if (!nameEl) return;

                    let name = nameEl.innerText.trim();
                    name = name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Strip accents

                    // FILTER FOR DEBUG
                    // Only dump for one date to avoid spam
                    if (dateStr === '2026-01-20') {
                        console.log(`[Jan 20] Scraped: ${name}`);
                    }

                    if (name.includes("Washington")) {
                        console.log(`MATCH FOUND: ${name} on ${dateStr}`);
                    } else {
                        return; // Skip non-matches
                    }

                    const getVal = (stat) => parseFloat(row.querySelector(`td[data-stat="${stat}"]`)?.innerText || '0');

                    results.push({
                        name: name,
                        date: dateStr,
                        pts: getVal('pts'),
                        reb: getVal('trb'),
                        ast: getVal('ast'),
                    });
                });
                return results;
            }, str);

            dailyStats.forEach(stat => {
                if (!logs[stat.name]) logs[stat.name] = [];
                logs[stat.name].push(stat);
            });

        } catch (err) {
            console.warn(`Error: ${err.message}`);
        }
    }
    return logs;
}

// L5 Logic (Exact copy from daily_workflow.js FIX)
function testL5(gameLogs) {
    console.log("\n--- TESTING L5 LOGIC ---");
    const logKey = Object.keys(gameLogs).find(k => k.toLowerCase() === PLAYER_NAME.toLowerCase()) || PLAYER_NAME;
    const pLogs = gameLogs[logKey];

    if (!pLogs || pLogs.length === 0) {
        console.log("❌ No logs found for", PLAYER_NAME);
        return;
    }

    console.log(`Found ${pLogs.length} logs for ${logKey}:`);
    pLogs.forEach(g => console.log(`   - ${g.date}: Pts=${g.pts}, Reb=${g.reb}, Ast=${g.ast}`));

    const recentLogs = pLogs.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    let hits = 0;
    let validGames = 0;
    const statMap = { 'p': 'pts', 'r': 'reb', 'a': 'ast', '3': 'threes', 's': 'stl', 'b': 'blk', 'to': 'to' };

    // TEST VARS
    const stat = STAT;
    const side = SIDE;
    const line = LINE;

    let logStat = statMap[stat];
    let isCombo = false;

    if (['pra', 'pr', 'pa', 'ra'].includes(stat)) {
        isCombo = true;
    }

    console.log(`\nAnalyzing ${stat.toUpperCase()} ${side} ${line}... (IsCombo: ${isCombo})`);

    if (logStat || isCombo) {
        recentLogs.forEach(g => {
            let val = 0;
            if (isCombo) {
                if (stat.includes('p')) val += (g.pts || 0);
                if (stat.includes('r')) val += (g.reb || 0);
                if (stat.includes('a')) val += (g.ast || 0);
            } else {
                val = g[logStat];
            }

            if (val !== undefined && val !== null) {
                validGames++;
                const result = (side === 'OVER' && val > line) || (side === 'UNDER' && val < line) ? "HIT" : "MISS";
                if (result === "HIT") hits++;
                console.log(`   Game Value: ${val} vs Line ${line} -> ${result}`);
            }
        });

        console.log(`\nResults: ${hits}/${validGames} Hits`);

        let l5Multiplier = 1.0;
        if (hits === 5) l5Multiplier = 1.20;
        else if (hits === 4) l5Multiplier = 1.15;
        else if (hits === 2) l5Multiplier = 0.90; // The logic causing 2/5 penalty
        else if (hits === 1) l5Multiplier = 0.85;

        if (hits === 0 && validGames === 5) console.log("DISQUALIFY TRIGGERED");

        console.log(`Multiplier: ${l5Multiplier}`);
    } else {
        console.log("❌ Logic bypassed (logStat is null and isCombo false)");
    }
}

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const logs = await fetchGameLogs(browser);
    await browser.close();
    testL5(logs);
})();

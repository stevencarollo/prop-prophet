const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const XLSX = require('xlsx');
const stringSimilarity = require('string-similarity'); // Ensure installed or replaced

require('dotenv').config();

// CONFIG
const BBM_USER = process.env.BBM_USER;
const BBM_PASS = process.env.BBM_PASS;
const MARKET_API_KEY = process.env.MARKET_API_KEY;

const DOWNLOAD_DIR = path.join(__dirname, '..');
const BBM_LOGIN_URL = 'https://basketballmonster.com/login.aspx';
const BBM_DATA_URL = 'https://basketballmonster.com/dailyprojections.aspx';

const EASE_DB_FILE = path.join(__dirname, '../ease_rankings.json');
const OUTPUT_FILE = path.join(__dirname, '../latest_picks.js');

// --- UTILS ---
function normalizeName(n) {
    if (!n) return '';
    return n.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- STEP 1: DOWNLOAD BBM DATA ---
async function downloadBBM() {
    console.log('🤖 [Step 1] Starting BBM Scraper...');
    if (!BBM_USER || !BBM_PASS) throw new Error('Missing BBM Credentials');

    const browser = await puppeteer.launch({
        headless: "new", // Headless for CI
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        // Setup Download
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOAD_DIR,
        });

        // 1. Login
        console.log('🔑 Logging in...');
        await page.goto(BBM_LOGIN_URL, { waitUntil: 'networkidle2' });
        await page.type('#UsernameTB', BBM_USER);
        await page.type('#PasswordTB', BBM_PASS);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#LoginButton')
        ]);

        // 2. Go to Projections
        console.log('📊 Navigating to Projections...');
        await page.goto(BBM_DATA_URL, { waitUntil: 'networkidle2' });

        // 3. Export
        console.log('⬇️ Exporting...');
        const [exportBtn] = await page.$$("xpath///input[@value='Export to Excel'] | //a[contains(text(), 'Export to Excel')]");
        if (!exportBtn) throw new Error('Export button not found');

        // Clear old files first
        const oldFiles = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
        oldFiles.forEach(f => fs.unlinkSync(path.join(DOWNLOAD_DIR, f)));

        await exportBtn.click();

        // Wait for download
        console.log('⏳ Waiting for download (15s)...');
        await delay(15000); // Increased wait time

        // Find file (Robust Check)
        const newFiles = fs.readdirSync(DOWNLOAD_DIR)
            .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'))
            // Sort by Modified Time (Newest First)
            .map(f => ({ name: f, time: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

        if (newFiles.length === 0) throw new Error('Download failed - no file found.');

        const latestFile = path.join(DOWNLOAD_DIR, newFiles[0].name);
        console.log(`✅ Downloaded: ${newFiles[0].name}`);

        // Read Buffer
        const fileBuffer = fs.readFileSync(latestFile);

        // Cleanup
        // fs.unlinkSync(latestFile); // Optional: keep for debug? No, CI cleans up.

        await browser.close();
        return fileBuffer;

    } catch (err) {
        await browser.close();
        throw err;
    }
}

// --- STEP 2: PARSE BBM ---
function parseBBM(buffer) {
    console.log('📖 [Step 2] Parsing Excel Data...');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (raw.length > 0) {
        console.log('[DEBUG] First Row Keys:', Object.keys(raw[0]));
        console.log('[DEBUG] First Row Data:', JSON.stringify(raw[0]));
    } else {
        console.error('[ERROR] Excel sheet appears empty');
    }

    // (This logic is ported from server.js - Simplified helper)
    const normKeys = raw.length > 0 ? Object.keys(raw[0]).map(k => k.toLowerCase()) : [];
    function findKey(keys) {
        for (const key of keys) {
            const idx = normKeys.findIndex(k => k === key.toLowerCase());
            if (idx !== -1) return Object.keys(raw[0])[idx];
        }
        return null;
    }

    // Mapping
    const nameKey = findKey(['name', 'player']);
    const teamKey = findKey(['team']);
    const posKey = findKey(['pos']);
    const oppKey = findKey(['opp']);
    const minKey = findKey(['min', 'mp', 'm/g']); // Added m/g
    const injKey = findKey(['inj']);
    const dateKey = findKey(['date', 'dt']);
    const timeKey = findKey(['time']);

    // Stats
    const pKey = findKey(['p', 'pts']);
    const threeKey = findKey(['3', '3pm']);
    const rKey = findKey(['r', 'reb']);
    const aKey = findKey(['a', 'ast']);
    const sKey = findKey(['s', 'stl']);
    const bKey = findKey(['b', 'blk']);
    const toKey = findKey(['to', 'tov']);
    const easeKey = findKey(['ease']);
    const statusKey = findKey(['status']);

    console.log(`[DEBUG] Keys Found: P=${pKey}, Min=${minKey}, Name=${nameKey}, Team=${teamKey}`);

    const players = [];

    raw.forEach(row => {
        const name = nameKey ? String(row[nameKey]).trim() : '';
        if (!name) return;

        // Parse Projections
        const proj = {
            p: pKey ? Number(row[pKey]) || 0 : 0,
            '3': threeKey ? Number(row[threeKey]) || 0 : 0,
            r: rKey ? Number(row[rKey]) || 0 : 0,
            a: aKey ? Number(row[aKey]) || 0 : 0,
            s: sKey ? Number(row[sKey]) || 0 : 0,
            b: bKey ? Number(row[bKey]) || 0 : 0,
            to: toKey ? Number(row[toKey]) || 0 : 0
        };
        proj.pr = proj.p + proj.r;
        proj.pa = proj.p + proj.a;
        proj.ra = proj.r + proj.a;
        proj.pra = proj.p + proj.r + proj.a;

        // Parse Time
        let startTs = 0;
        if (dateKey && timeKey) {
            let dStr = String(row[dateKey]).trim();
            let tStr = String(row[timeKey]).trim();
            if (dStr && tStr) {
                const fullStr = `${dStr} ${tStr} PST`;
                const parsed = Date.parse(fullStr);
                if (!isNaN(parsed)) startTs = parsed;
            }
        }

        players.push({
            name,
            name_norm: normalizeName(name),
            team: teamKey ? String(row[teamKey]).trim() : '',
            pos: posKey ? String(row[posKey]).split('/')[0].trim() : '',
            min: minKey ? Number(row[minKey]) || 0 : 0,
            ease: easeKey ? Number(row[easeKey]) || 0 : 0,
            status: statusKey ? String(row[statusKey]).trim() : '',
            injury: injKey ? String(row[injKey]) : '',
            opp: oppKey ? String(row[oppKey]).replace('@ ', '') : '',
            startTime: startTs,
            projections: proj
        });
    });

    console.log(`✅ Parsed ${players.length} players.`);
    return players;
}

// --- STEP 3: FETCH ODDS ---
async function fetchOdds() {
    console.log('🎲 [Step 3] Fetching Market Odds...');
    if (!MARKET_API_KEY) throw new Error('Missing MARKET_API_KEY');

    const evUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${MARKET_API_KEY}`;
    const evResp = await fetch(evUrl);
    if (!evResp.ok) throw new Error('Failed to fetch events');

    const events = await evResp.json();
    console.log(`Found ${events.length} games.`);

    // Filter started games
    const now = Date.now();
    const activeEvents = events.filter(e => new Date(e.commence_time).getTime() > now);

    const allOdds = [];
    const markets = 'player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_turnovers,player_points_rebounds,player_points_assists,player_rebounds_assists,player_points_rebounds_assists';

    for (const event of activeEvents) {
        console.log(`fetching: ${event.home_team} vs ${event.away_team}`);
        const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?regions=us&markets=${markets}&oddsFormat=american&apiKey=${MARKET_API_KEY}`;
        try {
            const r = await fetch(url);
            if (r.ok) {
                const data = await r.json();
                allOdds.push(data);
            }
        } catch (e) {
            console.error('Odds Error:', e.message);
        }
        await delay(200); // Rate limit kindness
    }
    return allOdds;
}

// --- STEP 4: ANALYSIS ENGINE ---
function generatePicks(bbmPlayers, oddsData) {
    console.log('🧠 [Step 4] Analyzing Matchups...');

    // Load Ease Data
    let EASE_DB = {};
    if (fs.existsSync(EASE_DB_FILE)) {
        EASE_DB = JSON.parse(fs.readFileSync(EASE_DB_FILE, 'utf8'));
    }

    // Build Odds Map
    const oddsMap = new Map(); // "normName|market" -> { line, price, event }

    oddsData.forEach(game => {
        game.bookmakers.forEach(book => {
            book.markets.forEach(mkt => {
                mkt.outcomes.forEach(out => {
                    // DEBUG: Print first outcome structure
                    if (Math.random() < 0.001) console.log('[API RAW]', JSON.stringify(out));

                    let pName = out.description || out.name; // Prefer description for props
                    // API v4 Spec:
                    // Player Props: name = "Over"/"Under", description = "Player Name"
                    // Head to Head: name = "Team Name"

                    if (out.name === 'Over' || out.name === 'Under') {
                        pName = out.description;
                    } else {
                        // Sometimes for "Player vs Player" it might differ? 
                        // For standard props, name is usually the selection.
                        pName = out.description || out.name;
                    }

                    if (!pName) return;

                    const key = `${normalizeName(pName)}|${mkt.key}`;
                    if (!oddsMap.has(key)) oddsMap.set(key, []);
                    oddsMap.get(key).push({
                        point: out.point,
                        price: out.price,
                        book: book.key,
                        startTime: game.commence_time,
                        opp: pName
                    });
                });
            });
        });
    });

    console.log(`[DEBUG] Odds Map Size: ${oddsMap.size}`);
    if (oddsMap.size > 0) {
        console.log('[DEBUG] First 3 Keys:', Array.from(oddsMap.keys()).slice(0, 3));
    }

    const STAT_MAP = {
        'p': 'player_points', 'r': 'player_rebounds', 'a': 'player_assists',
        '3': 'player_threes', 's': 'player_steals', 'b': 'player_blocks', 'to': 'player_turnovers',
        'pr': 'player_points_rebounds', 'pa': 'player_points_assists',
        'ra': 'player_rebounds_assists', 'pra': 'player_points_rebounds_assists'
    };

    const results = [];
    const STAT_WEIGHTS = { 'p': 1.0, 'r': 1.5, 'a': 1.6, '3': 1.7, 's': 3.5, 'b': 3.5, 'to': 2.5, 'pr': 0.9, 'pa': 0.9, 'ra': 1.1, 'pra': 0.85 };

    function interpret(easeVal, propType, direction) {
        if (propType === 'to') {
            if (direction === 'UNDER') {
                if (easeVal < 0) return "Opponent forces fewer TOs (Ease negative) → confirms Under.";
                return "Opponent pressure neutral/high → Risky Under.";
            } else {
                if (easeVal > 0) return "Opponent forces TOs (Ease positive) → supports Over.";
                return "Opponent passive → Over needs strong edge.";
            }
        }
        if (direction === 'OVER') {
            if (easeVal > 0.10) return "Positive Ease → Environment supports stat accumulation.";
            if (easeVal < -0.10) return "Negative Ease → Contradicts Over (check usage).";
            return "Neutral Ease → Edge drives the bet.";
        } else {
            if (easeVal < -0.10) return "Negative Ease → Environment suppresses stat (Confirms Under).";
            if (easeVal > 0.10) return "Positive Ease → Contradicts Under.";
            return "Neutral Ease → Edge drives the bet.";
        }
    }

    // Iterate Players
    bbmPlayers.forEach(player => {
        if (player.min < 20) return; // Min Minutes
        if (player.injury && player.injury.toLowerCase().includes('out')) return;

        Object.keys(player.projections).forEach(stat => {
            const mktKey = STAT_MAP[stat];
            if (!mktKey) return;

            const proj = player.projections[stat];
            if (proj < 1.0 && !['s', 'b', 'to'].includes(stat)) return;

            // Find Line
            // 1. Exact Match
            const exactKey = `${player.name_norm}|${mktKey}`;
            let lines = oddsMap.get(exactKey);

            if (!lines) return;

            // Average Line
            const calcLine = lines.reduce((acc, v) => acc + v.point, 0) / lines.length;
            const line = Math.round(calcLine * 2) / 2;

            // Calculate Edge
            let edge = 0;
            let side = 'OVER';
            if (stat === 'to') {
                if (line > proj) { side = 'UNDER'; edge = line - proj; }
                else { side = 'OVER'; edge = proj - line; }
            } else {
                edge = proj - line;
                side = edge > 0 ? 'OVER' : 'UNDER';
                if (edge < 0) { edge = Math.abs(edge); }
            }

            const weightedEdge = edge * (STAT_WEIGHTS[stat] || 1);

            // DEBUG: Show what edges we are finding
            if (weightedEdge > 0.05) {
                // console.log(`[DEBUG EDGE] ${player.name} ${stat.toUpperCase()} Edge: ${edge.toFixed(2)} (W: ${weightedEdge.toFixed(2)})`);
            }

            if (weightedEdge < 0.1) return; // Min Edge

            // Ease Logic (Simplified)
            let ease = player.ease;
            // In a full implementation, we'd query EASE_DB deeply. 
            // For now, use BBM's 'ease' column if available, or 0.

            // Confidence Logic
            let conf = 0.5 + (weightedEdge / 5);
            if (conf >= 0.99) conf = 0.99;

            // Confidence Grading
            let confGrade = "D";
            if (conf >= 0.90) confGrade = "A+ 🌟";
            else if (conf >= 0.85) confGrade = "A";
            else if (conf >= 0.80) confGrade = "A-";
            else if (conf >= 0.75) confGrade = "B+";
            else if (conf >= 0.70) confGrade = "B";
            else if (conf >= 0.60) confGrade = "C";

            // Narrative Generation
            let narrative = [];
            const displayStat = {
                'p': 'Points', 'r': 'Rebounds', 'a': 'Assists', '3': 'Threes', 's': 'Steals', 'b': 'Blocks', 'to': 'Turnovers',
                'pr': 'Pts+Reb', 'pa': 'Pts+Ast', 'ra': 'Reb+Ast', 'pra': 'Pts+Reb+Ast'
            }[stat] || stat.toUpperCase();

            // 1. THE OPENER
            if (weightedEdge > 8.0) narrative.push(`💎 **Massive Discrepancy**: The model prices this at ${proj.toFixed(1)}, giving us a massive **${edge.toFixed(2)} unit cushion** vs the market.`);
            else if (weightedEdge > 5.0) narrative.push(`💰 **Value Play**: We are capturing **${edge.toFixed(2)} points of implied value** here.`);
            else narrative.push(`🎯 **Solid Edge**: Model identifies a **${edge.toFixed(2)} point gap** vs public perception.`);

            // 2. THE MATCHUP
            if (ease >= 0.20) narrative.push(`✅ **Smash Spot**: ${player.opp} defense is bleeding ${displayStat} to this position (Ease: +${ease}). High ceiling environment.`);
            else if (ease <= -0.20 && side === 'UNDER') narrative.push(`🔒 **Defensive Clamp**: ${player.opp} ranks elite vs ${displayStat}. Expect usage to struggle.`);
            else if (Math.abs(ease) < 0.10) narrative.push(`⚖️ **Neutral Spot**: Matchup is average, but the volume projection (${proj.toFixed(1)}) carries the play.`);

            const deepAnalysis = narrative.join('<br>');

            // Construct Pick
            results.push({
                player: player.name,
                team: player.team,
                pos: player.pos,
                opp: player.opp,
                stat: stat,
                side: side,
                line: line,
                projection: proj.toFixed(2),
                edge: edge.toFixed(2),
                ease: ease,
                marketLine: `${line}`,
                betRating: weightedEdge > 2.0 ? "DIAMOND" : (weightedEdge > 1.0 ? "ELITE" : "SOLID"),
                confidence: conf,
                confidenceGrade: confGrade,
                score: weightedEdge.toFixed(2),
                interpretation: `Matchup: ${interpret(ease, stat, side)}`,
                analysis: deepAnalysis,
                startTime: player.startTime
            });
        });
    });

    // Sort by Score
    return results.sort((a, b) => b.score - a.score);
}


// --- MAIN WORKFLOW ---
(async () => {
    try {
        // 1. Download
        const xlsxBuffer = await downloadBBM();

        // 2. Parse
        const players = parseBBM(xlsxBuffer);

        // 3. Odds
        const odds = await fetchOdds();

        // 4. Generate
        const picks = generatePicks(players, odds);
        console.log(`✅ Generated ${picks.length} picks.`);

        // 5. Save
        const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const content = `window.LAST_UPDATED = "${timestamp}";\nwindow.LATEST_PICKS = ${JSON.stringify(picks, null, 2)};`;
        fs.writeFileSync(OUTPUT_FILE, content);
        console.log(`💾 Saved to ${OUTPUT_FILE}`);

    } catch (err) {
        console.error('❌ FATAL ERROR:', err);
        process.exit(1);
    }
})();

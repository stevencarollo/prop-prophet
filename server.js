// server.js
// Express server for Prop Prophet v3.0
// Features: BBM Excel Upload, The Odds API Proxy with Caching, Fuzzy Name Matching

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');
require('dotenv').config();

// Start Automation Scheduler
try { require('./scheduler'); } catch (e) { console.log('[Scheduler] Not started:', e.message); }

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Bypass-Tunnel-Reminder']
}));
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname)); // Serve index.html directly

const PORT = process.env.PORT || 3000;
const MARKET_API_KEY = process.env.MARKET_API_KEY;
// We append apiKey to the URL dynamically
const MARKET_API_BASE_URL = process.env.MARKET_API_URL;

const DATA_DIR = path.join(__dirname, 'data');
const BBM_FILE = path.join(DATA_DIR, 'bbm_daily.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Multer setup for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// --- Ease Data Management ---
const EASE_CHUNKS = ['ease_raw_chunk1.txt', 'ease_raw_chunk2.txt', 'ease_raw_chunk3.txt', 'ease_raw_chunk_pg_update.txt'];
const EASE_DB_FILE = 'ease_rankings.json';
let EASE_DB = {};

function rebuildEaseDb() {
    try {
        let combined = '';
        let foundAny = false;
        const rootDir = process.cwd(); // Assume chunks in root

        for (const chunk of EASE_CHUNKS) {
            const p = path.join(rootDir, chunk);
            if (fs.existsSync(p)) {
                combined += fs.readFileSync(p, 'utf8') + '\n';
                foundAny = true;
            }
        }

        if (!foundAny) {
            console.log('[Ease] No raw data chunks found. Skipping rebuild.');
            return;
        }

        const lines = combined.split('\n');
        const db = {};
        let currentPos = null;
        let currentTime = null;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line.includes('Past 1 Week')) currentTime = '1w';
            if (line.includes('Past 2 Weeks')) currentTime = '2w';
            if (line.includes('Full Season') || line.includes('full season')) currentTime = 'season';

            // Explicit position lines
            if (['All', 'PG', 'SG', 'SF', 'PF', 'C'].includes(line)) {
                currentPos = line;
                continue;
            }
            if (line.startsWith('vs Team')) continue;

            if (line.startsWith('vs ')) {
                if (!currentPos || !currentTime) continue;

                const cleanLine = line.replace('vs ', '').trim();
                const parts = cleanLine.split(/\s+/);
                const team = parts[0];

                // Indices per user table: 
                // 0:Team, 1:Val, 2:pV, 3:3V, 4:rV, 5:aV, 6:sV, 7:bV, 8:fgV, 9:toV
                const stats = {
                    val: parseFloat(parts[1]),
                    pV: parseFloat(parts[2]),
                    '3V': parseFloat(parts[3]),
                    rV: parseFloat(parts[4]),
                    aV: parseFloat(parts[5]),
                    sV: parseFloat(parts[6]),
                    bV: parseFloat(parts[7]),
                    toV: parseFloat(parts[9])
                };

                if (!db[currentPos]) db[currentPos] = {};
                if (!db[currentPos][currentTime]) db[currentPos][currentTime] = {};
                db[currentPos][currentTime][team] = stats;
            }
        }

        fs.writeFileSync(EASE_DB_FILE, JSON.stringify(db, null, 2));
        console.log(`[Ease] Rebuilt database from chunks. Saved to ${EASE_DB_FILE}`);
        EASE_DB = db;
    } catch (e) {
        console.error('[Ease] Rebuild failed:', e);
    }
}

function loadEaseData() {
    if (fs.existsSync(EASE_DB_FILE)) {
        try {
            EASE_DB = JSON.parse(fs.readFileSync(EASE_DB_FILE, 'utf8'));
            console.log('[Ease] Ease rankings loaded.');
        } catch (e) {
            console.error('[Ease] Error loading JSON, rebuilding...', e);
            rebuildEaseDb();
        }
    } else {
        console.log('[Ease] No DB found, rebuilding from raw chunks...');
        rebuildEaseDb();
    }
}

// Initial Load
loadEaseData();

// --- CACHING SETUP ---
let oddsCache = {
    data: null,
    timestamp: 0,
    duration: 10 * 60 * 1000 // 10 minutes cache to save API quota
};

// Map short stat keys to The Odds API market keys
const STAT_MARKET_KEY_MAP = {
    'p': 'player_points',
    'a': 'player_assists',
    '3': 'player_threes', // Also player_3pm sometimes, but Odds API uses player_threes typically
    'r': 'player_rebounds',
    's': 'player_steals',
    'b': 'player_blocks',
    'to': 'player_turnovers',
    'pr': 'player_points_rebounds',
    'pa': 'player_points_assists',
    'ra': 'player_rebounds_assists',
    'pra': 'player_points_rebounds_assists'
};

const TEAM_MAP = {
    'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets', 'CHI': 'Chicago Bulls',
    'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets', 'DET': 'Detroit Pistons', 'GSW': 'Golden State Warriors',
    'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers', 'LAC': 'Los Angeles Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies',
    'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves', 'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks',
    'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHO': 'Phoenix Suns', 'PHX': 'Phoenix Suns', 'POR': 'Portland Trail Blazers',
    'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs', 'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards',
    'SA': 'San Antonio Spurs', 'NY': 'New York Knicks', 'GS': 'Golden State Warriors', 'NO': 'New Orleans Pelicans'
};

// --- HELPER FUNCTIONS ---

function normalizeName(n) {
    if (!n) return '';
    return n.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Parse Excel buffer into structured BBM array
function parseBBMFromBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Convert to JSON with headers from sheet
    const raw = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    const players = [];
    const normKeys = raw.length > 0 ? Object.keys(raw[0]).map(k => k.toLowerCase()) : [];

    function findKey(keys) {
        for (const key of keys) {
            const idx = normKeys.findIndex(k => k === key.toLowerCase());
            if (idx !== -1) return Object.keys(raw[0])[idx];
        }
        return null;
    }

    // Column mapping
    const nameKey = findKey(['name', 'player', 'player name']);
    const teamKey = findKey(['team']);
    const posKey = findKey(['pos', 'position']);
    const oppKey = findKey(['opp', 'opponent']);

    // Stats/Projections
    const pKey = findKey(['p', 'pts', 'points']);
    const threeKey = findKey(['3', '3pm', 'threes']);
    const rKey = findKey(['r', 'reb', 'rebounds']);
    const aKey = findKey(['a', 'ast', 'assists']);
    const sKey = findKey(['s', 'stl', 'steals']);
    const bKey = findKey(['b', 'blk', 'blocks']);
    const toKey = findKey(['to', 'tov', 'turnovers']);

    // Context
    const easeKey = findKey(['ease']);
    const injKey = findKey(['inj', 'injury']);
    const restKey = findKey(['rest']);
    const b2bKey = findKey(['b2b']);
    const ageKey = findKey(['age']);
    const minKey = findKey(['min', 'mp', 'minutes', 'm/g']);

    // New: Date/Time parsing for live game filtering
    const dateKey = findKey(['date', 'game date', 'dt']);
    const timeKey = findKey(['time', 'game time', 'start']);

    // Trend Keys (Points Only)
    const l3Key = findKey(['3gg', 'l3', 'last 3']);
    const l5Key = findKey(['5gg', 'l5', 'last 5']);

    // Value & Consistency Keys
    const valCKey = findKey(['valuec', 'val c', 'value c']);
    const pcKey = findKey(['pc', 'p cons', 'consistency']);

    // Josh G Sharp Keys
    const joshKey = findKey(['josh', 'joshg', 'josh g']);
    const jMinKey = findKey(['jming', 'jmin', 'josh min']);
    const jMaxKey = findKey(['jmaxg', 'jmax', 'josh max']);
    const statusKey = findKey(['status', 'stat']); // New for Rookie detection
    const lastMinKey = findKey(['last min', 'last mp', 'min last', 'prev min', 'lmin']); // Last Game Minutes

    for (const row of raw) {
        const name = nameKey ? String(row[nameKey]).trim() : '';
        if (!name) continue;

        const projections = {
            p: pKey ? Number(row[pKey]) || 0 : 0,
            '3': threeKey ? Number(row[threeKey]) || 0 : 0,
            r: rKey ? Number(row[rKey]) || 0 : 0,
            a: aKey ? Number(row[aKey]) || 0 : 0,
            s: sKey ? Number(row[sKey]) || 0 : 0,
            b: bKey ? Number(row[bKey]) || 0 : 0,
            b: bKey ? Number(row[bKey]) || 0 : 0,
            to: toKey ? Number(row[toKey]) || 0 : 0
        };

        // Calculations for Combined Stats
        projections.pr = projections.p + projections.r;
        projections.pa = projections.p + projections.a;
        projections.ra = projections.r + projections.a;
        projections.pra = projections.p + projections.r + projections.a;

        // Parse Start Time if available
        let startTs = 0;
        if (dateKey && timeKey) {
            let dStr = String(row[dateKey]).trim(); // e.g. "1/16/2026"
            let tStr = String(row[timeKey]).trim(); // e.g. "7:00 PM"

            // Excel might export dates as serials if raw (but we use default). 
            // If they are strings, try direct parse with PST.
            if (dStr && tStr) {
                // Construct format: "MM/DD/YYYY HH:MM PM PST"
                // Adding 'PST' forces parsing in Pacific context
                const fullStr = `${dStr} ${tStr} PST`;
                const parsed = Date.parse(fullStr);

                // DATA DEBUG (Sample 5% of rows to avoid spam)
                if (Math.random() < 0.05) console.log(`[Time Debug] Raw: ${fullStr} | Parsed: ${new Date(parsed).toISOString()} | Now: ${new Date().toISOString()}`);

                if (!isNaN(parsed)) {
                    startTs = parsed;
                } else {
                    // Fallback: Try generic with explicit offset check if regex needed?
                    // For now, let's assume V8 handles "Date Time PST" well.
                }
            }
        }

        players.push({
            name: String(name).trim(),
            name_norm: normalizeName(name),
            team: teamKey ? String(row[teamKey]).trim() : '',
            pos: posKey ? String(row[posKey]).split('/')[0].trim() : '',
            age: ageKey ? Number(row[ageKey]) || null : null,
            rest: restKey ? Number(row[restKey]) || null : null,
            b2b: b2bKey ? Number(row[b2bKey]) || 0 : 0,
            ease: easeKey ? Number(row[easeKey]) || 0 : 0,
            min: minKey ? Number(row[minKey]) || 0 : 0,
            valueC: valCKey ? Number(row[valCKey]) || 0 : 0,
            pc: pcKey ? Number(row[pcKey]) || 0 : 0,
            val_3: l3Key ? Number(row[l3Key]) || 0 : 0,
            val_5: l5Key ? Number(row[l5Key]) || 0 : 0,
            josh: joshKey ? Number(row[joshKey]) || 0 : 0,
            jMin: jMinKey ? Number(row[jMinKey]) || 0 : 0,
            jMax: jMaxKey ? Number(row[jMaxKey]) || 0 : 0,
            status: statusKey ? String(row[statusKey]).trim() : '',
            lastMin: lastMinKey ? Number(row[lastMinKey]) || 0 : 0, // Last Game Mins
            startTime: startTs, // New Field
            injury: injKey ? String(row[injKey]) : '',
            opp: oppKey ? String(row[oppKey]).replace('@ ', '') : '',
            projections
        });
    }

    return players;
}

function saveBBM(players) {
    fs.writeFileSync(BBM_FILE, JSON.stringify({ uploaded_at: new Date().toISOString(), players }, null, 2), 'utf8');
}

function loadBBM() {
    if (!fs.existsSync(BBM_FILE)) return null;
    try {
        const raw = fs.readFileSync(BBM_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.warn('Failed to load BBM file', err);
        return null;
    }
}

// --- API ROUTES ---

app.post('/api/upload-bbm', upload.single('bbmfile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file missing' });
    try {
        const players = parseBBMFromBuffer(req.file.buffer);
        saveBBM(players);
        return res.json({ ok: true, count: players.length });
    } catch (err) {
        console.error('BBM Parse Error', err);
        return res.status(500).json({ error: 'Failed to parse BBM' });
    }
});

app.get('/api/bbm', (req, res) => {
    const data = loadBBM();
    if (!data) return res.json({ results: [] });
    return res.json(data);
});

app.post('/api/publish', (req, res) => {
    const { picks } = req.body;
    if (!picks) return res.status(400).json({ error: 'No picks provided' });

    const content = `window.LATEST_PICKS = ${JSON.stringify(picks, null, 2)};`;
    try {
        fs.writeFileSync(path.join(__dirname, 'latest_picks.js'), content, 'utf8');
        console.log('[Publish] Successfully saved latest_picks.js');
        return res.json({ ok: true });
    } catch (err) {
        console.error('Publish Error', err);
        return res.status(500).json({ error: 'Failed to write file' });
    }
});

// Fetch Odds from External API (with caching)
// Fetch Odds from External API (with caching)
async function fetchOdds() {
    const now = Date.now();

    // Check Cache
    if (oddsCache.data && (now - oddsCache.timestamp < oddsCache.duration)) {
        console.log('Using cached odds data');
        return oddsCache.data;
    }

    if (!MARKET_API_KEY) {
        console.warn('Missing API Config');
        return [];
    }

    try {
        console.log('Fetching active games list...');
        // Step 1: Get list of games (IDs)
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${MARKET_API_KEY}`;

        const resp = await fetch(eventsUrl);
        let startCredits = 0;
        if (resp.headers.get('x-requests-remaining')) {
            startCredits = Number(resp.headers.get('x-requests-remaining'));
            console.log(`[API START] Credits Remaining: ${startCredits}`);
        }

        if (!resp.ok) {
            const txt = await resp.text();
            console.error('Failed to fetch events:', resp.status, txt);
            return [];
        }

        const events = await resp.json();
        console.log(`Found ${events.length} games. Fetching props for each...`);

        if (events.length === 0) return [];

        // Step 2: Fetch props for each game
        const allOdds = [];
        const propMarkets = 'player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_turnovers,player_points_rebounds,player_points_assists,player_rebounds_assists,player_points_rebounds_assists,spreads';

        // We'll run these sequentially to ensure we get them all
        for (const event of events) {
            // FILTER: Skip Live/Started Games
            const startTime = new Date(event.commence_time).getTime();
            if (startTime < now) {
                console.log(`Skipping LIVE/Started game: ${event.home_team} vs ${event.away_team}`);
                continue;
            }

            const propsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?regions=us&markets=${propMarkets}&oddsFormat=american&apiKey=${MARKET_API_KEY}`;
            console.log(`Fetching props for ${event.home_team} vs ${event.away_team}...`);

            try {
                const pResp = await fetch(propsUrl);
                if (pResp.ok) {
                    // Credit Meter Logic
                    if (startCredits > 0 && pResp.headers.get('x-requests-remaining')) {
                        const current = Number(pResp.headers.get('x-requests-remaining'));
                        console.log(`[API METER] Used so far: ${startCredits - current} | Remaining: ${current}`);
                    }
                    const pData = await pResp.json();
                    allOdds.push(pData); // push the full event object with props
                } else {
                    console.warn(`Failed props for ${event.id}: ${pResp.status}`);
                }
            } catch (err) {
                console.error(`Error fetching props for ${event.id}`, err);
            }
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`Successfully fetched props for ${allOdds.length} games.`);

        oddsCache.data = allOdds;
        oddsCache.timestamp = now;
        return allOdds;

    } catch (err) {
        console.error('Master Odds Fetch Error:', err);
        return [];
    }
}

app.post('/api/market-lines', async (req, res) => {
    const { requests } = req.body || {};

    // DEBUG: Confirm request received
    console.log(`Received market-lines request. Items: ${requests ? requests.length : '0'}`);

    // requests: array of { player, team, stat }
    if (!Array.isArray(requests)) return res.status(400).json({ error: 'invalid requests' });

    const oddsData = await fetchOdds();
    const results = [];
    const resolvedKeys = new Set();

    // Create a map of normalized player name -> array of outcome references
    // Iterate ALL events -> bookmakers -> markets -> outcomes

    // Optimizing for lookup:
    // Map<"player_norm|stat_key", { line, price }>
    // We'll average lines if multiple books have them, or pick the best one. 
    // For simplicity, let's take DraftKings if available, otherwise first available.

    const playerOddsMap = new Map();

    // Processing Stats
    let stats = { total: requests.length, lineFound: 0, timeBlocked: 0, minBlocked: 0, teamBlocked: 0, processed: 0 };

    if (Array.isArray(oddsData)) {
        oddsData.forEach(event => {
            if (!event.bookmakers) return;

            // DYNAMIC FILTER: Check if game has started NOW (even if cached)
            const startTime = new Date(event.commence_time).getTime();
            const now = Date.now();
            const timeDiffMins = (startTime - now) / 60000;

            console.log(`[Game Check] ${event.home_team} vs ${event.away_team} | Starts in: ${timeDiffMins.toFixed(1)} mins | Action: ${timeDiffMins < 0 ? 'SKIP' : 'KEEP'}`);

            if (startTime < now) {
                return;
            }

            // Filter for specific bookmakers if desired, e.g. DraftKings, FanDuel.
            // For now, iterate all and prefer major ones.
            event.bookmakers.forEach(book => {
                if (!book.markets) return;

                // Pre-scan for Spread (Blowout Risk)
                const spreadMkt = book.markets.find(m => m.key === 'spreads');
                const spreadLine = spreadMkt && spreadMkt.outcomes.length > 0 ? Math.abs(spreadMkt.outcomes[0].point) : 0;

                book.markets.forEach(market => {
                    if (!market.outcomes) return;
                    if (market.key === 'spreads') return; // Skip spread processing for props
                    market.outcomes.forEach(outcome => {
                        // FIX: Detect if name is Over/Under vs Player Name
                        let rawName = outcome.name;

                        // DEBUG
                        if (playerOddsMap.size < 3) console.log(`[API DEBUG] Name: ${outcome.name}, Desc: ${outcome.description}`);

                        if (rawName === 'Over' || rawName === 'Under') {
                            rawName = outcome.description; // Swap!
                        }

                        if (!rawName) return;
                        const pNorm = normalizeName(rawName);
                        const key = `${pNorm}|${market.key}`;

                        if (!playerOddsMap.has(key)) {
                            playerOddsMap.set(key, []);
                        }

                        playerOddsMap.get(key).push({
                            point: outcome.point,
                            price: outcome.price,
                            book: book.key,
                            desc: outcome.description,
                            event: `${event.home_team} vs ${event.away_team}`,
                            event: `${event.home_team} vs ${event.away_team}`,
                            startTime: event.commence_time, // CRITICAL: Pass time for final check
                            gameSpread: spreadLine // Attach Spread for Blowout Logic
                        });
                    });
                });
            });
        });
    }

    // v1.0 Scoring Configuration
    const SETTINGS = {
        min_edge: 0.1,
        rest0_penalty: 0.05,
        b2b_penalty_young: 0.03,
        b2b_penalty_vet: 0.08,
        vet_age_threshold: 30,
        ease_weights: { "1w": 0.50, "2w": 0.30, "season": 0.20 }
    };

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

    // Requests loop
    for (const reqItem of requests) {
        const { player, stat } = reqItem;
        const marketKey = STAT_MARKET_KEY_MAP[stat];

        let foundLine = null;
        let usedSource = 'api';
        let lines = null; // Scope fix for ReferenceError

        // 1. Try to find line in API data
        if (marketKey && playerOddsMap.size > 0) {
            const pNorm = normalizeName(player);
            // Strict match first
            const exactKey = `${pNorm}|${marketKey}`;
            lines = playerOddsMap.get(exactKey);

            // Fuzzy fallback
            if (!lines) {
                if (requests.indexOf(reqItem) < 3) console.log(`Strict failed for '${exactKey}'. Trying fuzzy...`);

                const candidates = [];
                for (const k of playerOddsMap.keys()) {
                    if (k.endsWith(`|${marketKey}`)) {
                        candidates.push(k.split('|')[0]);
                    }
                }

                if (candidates.length > 0) {
                    const best = stringSimilarity.findBestMatch(pNorm, candidates);
                    const rating = best.bestMatch.rating;

                    if (requests.indexOf(reqItem) < 3) console.log(`Best fuzzy for ${pNorm}: ${best.bestMatch.target} (${rating.toFixed(2)})`);

                    if (rating > 0.60) {
                        const fuzzyKey = `${best.bestMatch.target}|${marketKey}`;
                        lines = playerOddsMap.get(fuzzyKey);
                    }
                }
            }

            if (lines && lines.length > 0) {
                // TEAM CHECK GUARD
                const reqTeam = reqItem.team ? reqItem.team.toUpperCase() : '';
                const fullTeam = TEAM_MAP[reqTeam];

                // If we have a mapped team, and the event does NOT contain it -> Skip
                if (fullTeam && !lines[0].event.includes(fullTeam)) {
                    if (requests.indexOf(reqItem) < 5) console.log(`[Team Mismatch] ${player} (${reqTeam}) matched to wrong event: ${lines[0].event}`);
                    stats.teamBlocked++;
                    lines = null;
                    continue;
                }

                // Final Live Guard: Check Start Time of the Match
                const matchTime = new Date(lines[0].startTime).getTime();
                const now = Date.now();

                // DEBUG
                if (requests.indexOf(reqItem) < 5) console.log(`[Live Guard] ${player} | Match: ${new Date(matchTime).toLocaleTimeString()} | Now: ${new Date(now).toLocaleTimeString()} | Diff: ${(matchTime - now) / 60000}m`);

                // SAFETY: Fail closed if time is missing or in past
                if (!matchTime || isNaN(matchTime) || matchTime < now) {
                    console.log(`[Live Guard] BLOCKED ${player} (Game started at ${lines[0].startTime})`);
                    stats.timeBlocked++;
                    continue; // Skip this player strictly
                }

                // Average the lines found
                const points = lines.map(l => l.point);
                const avg = points.reduce((a, b) => a + b, 0) / points.length;
                foundLine = Math.round(avg * 2) / 2;
                stats.lineFound++;

                // TRACE
                const sourceEvent = lines[0].event;
                if (requests.indexOf(reqItem) < 5 || player.includes('Keyonte')) {
                    console.log(`[MATCH] ${player} (${marketKey}) -> Line: ${foundLine} | Source: ${sourceEvent}`);
                }
            }
        }

        // 2. Strict Rule: If no line, SKIP. Do not simulate.
        if (foundLine === null) {
            continue;
        }

        // 3. Get Projection details from BBM data loaded in memory (reqItem has subsets)

        const bbmData = loadBBM();
        const bbmPlayer = bbmData ? bbmData.players.find(p => normalizeName(p.name) === normalizeName(player)) : null;

        // BBM Start Time Filter (User provided columns)
        if (bbmPlayer && bbmPlayer.startTime) {
            // DEBUG
            if (requests.indexOf(reqItem) < 5) console.log(`[BBM Time] ${player} | Start: ${new Date(bbmPlayer.startTime).toLocaleTimeString()} | Now: ${new Date().toLocaleTimeString()}`);

            // Buffer: Allow 10 mins ?? No, strict.
            if (bbmPlayer.startTime < Date.now()) {
                console.log(`[BBM Filter] Skipping ${player} (Started)`);
                stats.timeBlocked++;
                continue;
            }
        }

        // If we can't find full stats, skip or use defaults
        const proj = bbmPlayer ? (bbmPlayer.projections[stat] || 0) : 0; // Use server-size proj validation
        if (proj < 1) continue;

        // FILTER: Minutes > 20
        const minutes = bbmPlayer ? (Number(bbmPlayer.min) || 0) : 0;
        // console.log(`[Filter Check] ${player}: ${minutes} mins`);
        if (minutes < 20) { stats.minBlocked++; continue; }

        let modProj = proj;
        let side = "OVER";
        let edge = 0;

        // --- EASE CALCULATION (Weighted & Split) ---
        let posEaseVal = 0;
        let teamEaseVal = 0;
        let activeEaseVal = 0;
        let easeBreakdown = "No Data";

        const oppTeam = bbmPlayer ? bbmPlayer.opp.replace(/[@vs]/g, '').trim().toUpperCase() : '';
        const componentStats = {
            'pr': ['pV', 'rV'],
            'pa': ['pV', 'aV'],
            'ra': ['rV', 'aV'],
            'pra': ['pV', 'rV', 'aV']
        };
        const comps = componentStats[stat] || [(stat === '3' ? '3V' : `${stat}V`)];

        if (bbmPlayer && oppTeam && EASE_DB) {
            const rawPos = bbmPlayer.pos || 'All';
            const specificPos = (['PG', 'SG', 'SF', 'PF', 'C'].includes(rawPos)) ? rawPos : null;

            const calcWeighted = (posKey) => {
                if (!EASE_DB[posKey]) return 0;
                let totalEase = 0;

                for (const k of comps) {
                    const getV = (tf) => (EASE_DB[posKey][tf] && EASE_DB[posKey][tf][oppTeam]) ? EASE_DB[posKey][tf][oppTeam][k] : 0;
                    totalEase += (getV('1w') * SETTINGS.ease_weights["1w"]) +
                        (getV('2w') * SETTINGS.ease_weights["2w"]) +
                        (getV('season') * SETTINGS.ease_weights["season"]);
                }
                return totalEase / comps.length;
            };

            // 1. Team Matchup Ease (General Defense)
            teamEaseVal = calcWeighted('All');

            // 2. Positional Expected Ease
            if (specificPos) {
                posEaseVal = calcWeighted(specificPos);
                activeEaseVal = posEaseVal; // Prioritize specific
            } else {
                activeEaseVal = teamEaseVal; // Fallback
            }

            easeBreakdown = `Pos: ${posEaseVal.toFixed(2)}, Team: ${teamEaseVal.toFixed(2)}`;
        }

        let easeVal = activeEaseVal; // Compass backwards compatibility variable

        // Turnover Logic
        if (stat === 'to') {
            if (foundLine > proj) {
                side = "UNDER";
                edge = foundLine - proj;
            } else {
                side = "OVER";
                edge = proj - foundLine;
            }
        } else {
            edge = proj - foundLine;
            side = edge > 0 ? "OVER" : "UNDER";
            if (edge < 0) {
                side = "UNDER";
                edge = Math.abs(edge);
            }
        }

        // Normalize Edge for low-volume stats (Balanced Weights v3)
        const STAT_WEIGHTS = {
            'p': 1.0, 'r': 1.5, 'a': 1.6, '3': 1.7, 's': 3.5, 'b': 3.5, 'to': 2.5,
            'pr': 0.90, 'pa': 0.90, 'ra': 1.10, 'pra': 0.85
        };
        const weight = STAT_WEIGHTS[stat] || 1.0;
        const scoringEdge = edge * weight;

        // Use Scoring Edge for Filtering (so 0.5 steals edge passes the 1.5 filter)
        if (scoringEdge < SETTINGS.min_edge) continue;

        // Ease Rating & Score Multiplier
        let easeRating = "NEUTRAL";
        let scoreMultiplier = 1.0;

        // "Substantial Advantage" Logic
        if (side === 'OVER') {
            if (activeEaseVal >= 0.50) { easeRating = "ELITE"; scoreMultiplier = 1.25; }
            else if (activeEaseVal >= 0.25) { easeRating = "GREAT"; scoreMultiplier = 1.15; }
            else if (activeEaseVal >= 0.10) { easeRating = "GOOD"; scoreMultiplier = 1.10; }
            else if (activeEaseVal <= -0.10) { easeRating = "BAD"; scoreMultiplier = 0.90; }
            if (activeEaseVal <= -0.30) { easeRating = "TOUGH"; scoreMultiplier = 0.75; }
        } else { // UNDER
            // Negative ease is GOOD for Under
            if (activeEaseVal <= -0.50) { easeRating = "ELITE"; scoreMultiplier = 1.25; }
            else if (activeEaseVal <= -0.25) { easeRating = "GREAT"; scoreMultiplier = 1.15; }
            else if (activeEaseVal <= -0.10) { easeRating = "GOOD"; scoreMultiplier = 1.10; }
            else if (activeEaseVal >= 0.10) { easeRating = "BAD"; scoreMultiplier = 0.90; }
        }

        // Confidence Score Calculation (v1 Spec) using Normalized Edge
        let conf = Math.min(0.95, 0.45 + (scoringEdge / 6.0));

        // Ease Bonus/Penalty to Confidence
        if (side === 'OVER') {
            if (activeEaseVal > 0) conf += Math.min(0.15, activeEaseVal / 10.0);
            else if (activeEaseVal < -0.15) {
                conf -= 0.20; // Contradiction Penalty
                easeBreakdown += " [CONTRADICTS]";
            }
        } else { // UNDER
            if (activeEaseVal < 0) conf += Math.min(0.15, Math.abs(activeEaseVal) / 10.0);
            else if (activeEaseVal > 0.15) {
                conf -= 0.20;
                easeBreakdown += " [CONTRADICTS]";
            }
        }

        // Penalties (Rest, Age, B2B)
        if (bbmPlayer) {
            if (bbmPlayer.rest === 0) conf -= SETTINGS.rest0_penalty;
            if (bbmPlayer.b2b >= 1) {
                if ((bbmPlayer.age || 25) >= SETTINGS.vet_age_threshold) {
                    conf -= SETTINGS.b2b_penalty_vet;
                } else {
                    conf -= SETTINGS.b2b_penalty_young;
                }
            }

            // Blowout Risk Logic (Spread >= 10.0) -- UPDATED PER USER REQUEST
            const gameSpread = (lines && lines.length > 0) ? (lines[0].gameSpread || 0) : 0;
            if (Math.abs(gameSpread) >= 10.0 && side === 'OVER') {
                conf -= 0.20; // HEAVY Penalty (-20%)
                if ((bbmPlayer.age || 25) >= SETTINGS.vet_age_threshold) {
                    conf -= 0.10; // Vets sit earlier (Total -30%)
                }
                easeRating += " [BLOWOUT WARNING]";
            }

            // General Form (L3/L5 Value) - Applies to ALL Stats
            const v3 = bbmPlayer.val_3 || 0;
            const v5 = bbmPlayer.val_5 || 0;
            // Use Max of L3/L5 to check for Heat
            const maxVal = Math.max(v3, v5);
            const minVal = Math.min(v3, v5);

            if (maxVal >= 1.0) { // High Value = Hot
                if (side === 'OVER') {
                    conf += 0.05;
                    easeBreakdown += " [HOT 🔥]";
                }
            } else if (minVal <= -1.0) { // Low Value = Cold
                if (side === 'UNDER') {
                    conf += 0.05; // Fade the slump
                    easeBreakdown += " [COLD ❄️]";
                } else { // Betting Over a Cold player
                    conf -= 0.05;
                    easeBreakdown += " [SLUMP]";
                }
            }

            // Value C (Recent Value) - Global Impact
            const valC = bbmPlayer.valueC || 0;
            if (valC >= 1.5) {
                if (side === 'OVER') { conf += 0.04; easeBreakdown += " [VAL+]"; }
            } else if (valC <= -1.5) {
                if (side === 'OVER') { conf -= 0.04; easeBreakdown += " [VAL-]"; }
            }

            // PC (Points Consistency) - Points Only
            if (stat === 'p') {
                const pc = bbmPlayer.pc || 0;
                if (pc >= 65) {
                    conf += 0.05; easeBreakdown += " [STEADY]";
                } else if (pc > 0 && pc <= 35) {
                    conf -= 0.05; easeBreakdown += " [VOLATILE]";
                }
            }

            // Josh G (Sharp Input) - Extra Weight
            const josh = bbmPlayer.josh || 0;
            const jMin = bbmPlayer.jMin || 0;
            const jMax = bbmPlayer.jMax || 0;

            if (josh !== 0) {
                // Sharp Approval (High Value)
                if (josh >= 1.5 && side === 'OVER') {
                    conf += 0.06; easeBreakdown += " [SHARP+]";
                } else if (josh <= -1.5 && side === 'UNDER') {
                    conf += 0.06; easeBreakdown += " [SHARP-]";
                }

                // Floor/Ceiling Checks
                if (side === 'OVER' && jMin > -1.0) { // High Floor (Safe)
                    conf += 0.03; easeBreakdown += " [SAFE FLOOR]";
                }
                if (side === 'UNDER' && jMax < 1.0) { // Low Ceiling (Safe Under)
                    conf += 0.03; easeBreakdown += " [CAPPED]";
                }
            }
        }

        conf = Math.max(0.01, Math.min(0.99, conf)); // Clamp

        // Confidence Grading
        let confGrade = "D";
        if (conf >= 0.90) confGrade = "A+ 🌟";
        else if (conf >= 0.85) confGrade = "A";
        else if (conf >= 0.80) confGrade = "A-";
        else if (conf >= 0.75) confGrade = "B+";
        else if (conf >= 0.70) confGrade = "B";
        else if (conf >= 0.60) confGrade = "C";

        // Check if edge meets criteria (using Normalized Edge)
        if (scoringEdge >= SETTINGS.min_edge) {
            // Final Prophet Points Calculation (Scaled to 1-10)
            const rawScore = scoringEdge * conf * scoreMultiplier;
            const scaledScore = rawScore * 2.5;
            const prophetPoints = scaledScore.toFixed(2);

            // Filter: Don't show anything below 6.5
            if (scaledScore < 6.5) continue;

            // Determine Base Tier
            let betRating = "✅ SOLID PLAY"; // Initialize with lowest tier
            if (scaledScore >= 11.0) betRating = "🔒 PROPHET LOCK";
            else if (scaledScore >= 9.5) betRating = "💎 DIAMOND BOY";
            else if (scaledScore >= 8.5) betRating = "🔥 ELITE";
            else if (scaledScore >= 7.5) betRating = "💪 STRONG PLAY";

            // --- GATES (Strict Minutes & Rookie) ---
            const min = bbmPlayer ? (bbmPlayer.min || 0) : 0;
            const status = bbmPlayer ? (bbmPlayer.status || '').toLowerCase() : '';
            const v5 = bbmPlayer ? (bbmPlayer.val_5 || 0) : 0;
            const lastMin = bbmPlayer ? (bbmPlayer.lastMin || 0) : 0;

            // Display Last Game Mins context if discrepancy exists
            if (lastMin > 0 && Math.abs(min - lastMin) >= 5) {
                if (lastMin > min) easeBreakdown += ` [HVL: ${lastMin}m]`;
                else easeBreakdown += ` [LVL: ${lastMin}m]`;
            }

            // Apply Caps
            let capAtStrong = false;
            // Gate 1: Minutes
            if (min < 23) capAtStrong = true;
            // Gate 2: Rookie
            if (status.includes('rookie')) {
                if (v5 < 1.0 || min < 23) capAtStrong = true;
            }

            // Downgrade if Capped
            if (capAtStrong) {
                if (betRating.includes("LOCK") || betRating.includes("DIAMOND") || betRating.includes("ELITE")) {
                    betRating = "💪 STRONG PLAY";
                }
            }

            // --- PROPHET BREAKDOWN (Sharp Persona) ---
            let narrative = [];

            // Map keys
            const displayStat = {
                'p': 'Points', 'r': 'Rebounds', 'a': 'Assists', '3': 'Threes', 's': 'Steals', 'b': 'Blocks', 'to': 'Turnovers',
                'pr': 'Pts+Reb', 'pa': 'Pts+Ast', 'ra': 'Reb+Ast', 'pra': 'Pts+Reb+Ast'
            }[stat] || stat.toUpperCase();

            // 1. THE OPENER (Value/Edge)
            const edgeVal = (scoringEdge >= 5.0) ? scoringEdge.toFixed(1) : (Math.abs(foundLine - proj)).toFixed(1);
            if (scoringEdge > 8.0) narrative.push(`💎 **Massive Discrepancy**: The model prices this at ${proj.toFixed(1)}, giving us a massive **${edgeVal} unit cushion** vs the market.`);
            else if (scoringEdge > 5.0) narrative.push(`💰 **Value Play**: We are capturing **${edgeVal} points of implied value** here. The market is sleeping on this.`);
            else narrative.push(`🎯 **Solid Edge**: Model identifies a **${edgeVal} point gap** vs public perception.`);

            // 2. THE FORM (L5 / Consistency)
            if (v5 >= 1.0) narrative.push(`🔥 **Current Form**: Player is scorching hot, crushing this number recently (Val: ${v5}). Ride the wave.`);
            else if (v5 <= -1.0 && side === 'UNDER') narrative.push(`❄️ **Fade Mode**: Player is in a slump, failing to clear this line consistently. Valid fade.`);
            else if (bbmPlayer.pc > 65) narrative.push(`🛡️ **Consistency King**: Hits this metric at a ${bbmPlayer.pc}% clip, offering a high floor.`);

            // 3. THE MATCHUP (Ease)
            if (activeEaseVal >= 0.20) narrative.push(`✅ **Smash Spot**: ${oppTeam} defense is bleeding ${displayStat} to this position (Ease: +${activeEaseVal}). High ceiling environment.`);
            else if (activeEaseVal <= -0.20 && side === 'UNDER') narrative.push(`🔒 **Defensive Clamp**: ${oppTeam} ranks elite vs ${displayStat}. Expect usage to struggle.`);
            else if (Math.abs(activeEaseVal) < 0.10) narrative.push(`⚖️ **Neutral Spot**: Matchup is average, but the volume projection (${proj.toFixed(1)}) carries the play.`);

            // 4. THE RISKS (Sharp/Blowout)
            const joshVal = bbmPlayer.josh || 0;
            if (joshVal > 1.0) narrative.push(`🦈 **Sharp Action**: 'Josh G' indicators signal smart money is backing this Over.`);

            // Re-extract spread
            const closingSpread = (lines && lines.length > 0) ? (lines[0].gameSpread || 0) : 0;
            if (Math.abs(closingSpread) >= 10) narrative.push(`⚠️ **Game Script**: ${closingSpread}pt spread implies a blowout. Size down slightly for 4th qtr sitting risk.`);

            const deepAnalysis = narrative.join('<br>');

            results.push({
                player: bbmPlayer ? bbmPlayer.name : player,
                team: bbmPlayer ? bbmPlayer.team : 'N/A',
                pos: bbmPlayer ? bbmPlayer.pos : 'N/A',
                stat: stat,
                side: side,
                line: foundLine,
                marketLine: foundLine,
                edge: edge.toFixed(1),
                projection: proj.toFixed(2),
                ease: activeEaseVal.toFixed(2),
                confidence: conf,
                confidenceGrade: confGrade,
                score: prophetPoints,
                betRating: betRating,
                interpretation: `Matchup: [${easeRating}] ${interpret(activeEaseVal, stat, side)} | PosEase: ${posEaseVal.toFixed(2)} / TeamEase: ${teamEaseVal.toFixed(2)}`,
                opp: bbmPlayer ? bbmPlayer.opp : 'N/A',
                analysis: deepAnalysis,
                startTime: (lines && lines.length > 0) ? lines[0].startTime : null
            });
            resolvedKeys.add(player);
        }
    }

    // Sort by Prophet Points (Score)
    results.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

    return res.json({ results });
});

// Listen explicitly on IPv4 to ensure Tunnel visibility
// --- FORCE UPDATE ENDPOINT ---
app.post('/api/force-update', (req, res) => {
    console.log('[Update] Manual Trigger received. Attempting to launch robot...');
    const { exec } = require('child_process');
    const path = require('path');
    const scriptPath = path.join(__dirname, 'scripts', 'download_bbm.js');

    // Use the exact same Node executable that started this server to avoid PATH issues
    const nodeExe = process.execPath;

    // Execute the robot
    exec(`"${nodeExe}" "${scriptPath}"`, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Update Error] Child process failed: ${error.message}`);
            console.error(`[Update Stderr] ${stderr}`);
            return res.status(500).json({ error: 'Update Failed', details: error.message });
        }
        console.log('[Update Output]:', stdout);
        if (stderr) console.log('[Update Log]:', stderr);
        res.json({ success: true, message: 'Update & Deploy Complete!' });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Prop Prophet v3 Server running on port ${PORT}`);
});

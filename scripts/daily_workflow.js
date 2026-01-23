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
const OUTPUT_FILE = path.join(__dirname, '../latest_picks_live.js');
const HISTORY_FILE = path.join(__dirname, '../history/prophet_history.json');

// --- HISTORY & TRACKING FUNCTIONS ---

function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
    return [];
}

function resolveHistory(history, gameLogs) {
    let resolvedCount = 0;
    history.forEach(pick => {
        if (pick.result !== 'PENDING') return;

        // SAFEGUARD: Do NOT resolve picks from "Today" (games incomplete)
        // SAFEGUARD: Do NOT resolve picks from "Today" (games incomplete)
        // Only resolve matches from Yesterday or earlier
        // Fix: Use LA Time (User's Timezone) so late night isn't "Tomorrow"
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        if (pick.date === today) return;

        // Find Player Logs
        const logKey = Object.keys(gameLogs).find(k => k.toLowerCase() === pick.player.toLowerCase());
        if (!logKey) return; // Player not found in logs

        const logs = gameLogs[logKey];
        // Find Game Log matching Pick Date
        const game = logs.find(g => g.date === pick.date);

        if (game) {
            // Map Stat
            const statMap = { 'p': 'pts', 'r': 'reb', 'a': 'ast', '3': 'threes', 's': 'stl', 'b': 'blk', 'to': 'to' };
            const logStat = statMap[pick.stat];

            // Handle Combo Stats (pra, pr, pa, ra)
            let actual = 0;
            if (['pra', 'pr', 'pa', 'ra'].includes(pick.stat)) {
                if (pick.stat.includes('p')) actual += game.pts;
                if (pick.stat.includes('r')) actual += game.reb; // Fix: 'trb' was wrong, 'reb' is key in logs
                if (pick.stat.includes('a')) actual += game.ast;
            } else {
                actual = game[logStat];
            }

            if (actual !== undefined) {
                pick.actual = actual;

                if (pick.side === 'OVER') {
                    if (actual > pick.line) pick.result = 'WIN';
                    else if (actual < pick.line) pick.result = 'LOSS';
                    else pick.result = 'PUSH';
                } else if (pick.side === 'UNDER') {
                    if (actual < pick.line) pick.result = 'WIN';
                    else if (actual > pick.line) pick.result = 'LOSS';
                    else pick.result = 'PUSH';
                }
                resolvedCount++;
                console.log(`   ✅ Resolved: ${pick.player} ${pick.stat} (${pick.side} ${pick.line}) -> Got ${actual} = ${pick.result}`);
            }
        }
    });

    if (resolvedCount > 0) {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        console.log(`📊 Resolved ${resolvedCount} pending picks.`);
    }
    return history;
}

function updateHistory(history, newPicks) {
    const today = new Date().toISOString().split('T')[0];
    let added = 0;
    let updated = 0;

    newPicks.forEach(p => {
        // Use Game Date if available, otherwise Today
        let pickDate = today;
        if (p.startTime) {
            pickDate = new Date(p.startTime).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        }

        // Create unique ID
        const id = `${p.player}-${p.stat}-${pickDate}`.replace(/\s+/g, '');

        // Check if exists
        const existingIndex = history.findIndex(h => h.id === id);

        if (existingIndex === -1) {
            // NEW PICK
            history.push({
                id: id,
                player: p.player,
                team: p.team,
                opp: p.opp,
                stat: p.stat,
                line: p.line,
                side: p.side,
                tier: p.betRating,
                date: pickDate,
                result: 'PENDING',
                actual: null
            });
            added++;
        } else {
            // EXISTING PICK - Update if still PENDING
            // This ensures "Diamond" -> "Lock" upgrades are captured in history
            if (history[existingIndex].result === 'PENDING') {
                const h = history[existingIndex];
                // Only log if something important changed to reduce noise
                if (h.tier !== p.betRating || h.line !== p.line) {
                    // console.log(`🔄 Updating ${h.player} (${h.stat}): ${h.tier} -> ${p.betRating}`);
                    updated++;
                }

                history[existingIndex].tier = p.betRating;
                history[existingIndex].line = p.line;
                history[existingIndex].side = p.side; // Just in case
                // We keep the original ID/Date
            }
        }
    });

    if (added > 0 || updated > 0) {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        console.log(`📝 History: Added ${added} new, Updated ${updated} existing picks.`);
    }
    return history;
}
function generateStats(history) {
    const stats = {
        season: { w: 0, l: 0, p: 0, total: 0, pct: 0 },
        locks: { w: 0, l: 0, p: 0, total: 0, pct: 0 },
        diamond: { w: 0, l: 0, p: 0, total: 0, pct: 0 },
        elite: { w: 0, l: 0, p: 0, total: 0, pct: 0 }
    };

    history.forEach(h => {
        if (h.result === 'PENDING' || h.result === 'PUSH') return; // Skip pending/push for Win%

        // Global
        if (h.result === 'WIN') stats.season.w++;
        if (h.result === 'LOSS') stats.season.l++;

        // Tiers
        let tierKey = null;
        if (h.tier.includes('LOCK')) tierKey = 'locks';
        if (h.tier.includes('DIAMOND')) tierKey = 'diamond';
        if (h.tier.includes('ELITE')) tierKey = 'elite';

        if (tierKey) {
            if (h.result === 'WIN') stats[tierKey].w++;
            if (h.result === 'LOSS') stats[tierKey].l++;
        }
    });

    // Calculate Percentages
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

// --- STEP 3b: FETCH EASE DATA (BBM SCRAPER) ---
async function fetchBBMEase() {
    console.log('🛡️ [Step 3b] Fetching Ease Rankings from BBM...');
    if (!BBM_USER || !BBM_PASS) {
        console.warn('⚠️ Missing BBM Creds. Using cached Ease DB if available.');
        try {
            if (fs.existsSync(EASE_DB_FILE)) return JSON.parse(fs.readFileSync(EASE_DB_FILE));
        } catch (e) { return {}; }
        return {};
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    const DB = {};

    // Config
    const POSITIONS = [
        { name: 'All', value: '0' },
        { name: 'PG', value: '4' },
        { name: 'SG', value: '5' },
        { name: 'SF', value: '6' },
        { name: 'PF', value: '7' },
        { name: 'C', value: '3' }
    ];
    const RANGES = [
        { name: 'season', value: 'FullSeason' },
        { name: '1w', value: 'LastWeek' },
        { name: '2w', value: 'LastTwoWeeks' },
        { name: '3w', value: 'LastThreeWeeks' },
        { name: '1m', value: 'LastMonth' }
    ];

    try {
        // 1. Login
        console.log('   > Logging in...');
        await page.goto(BBM_LOGIN_URL, { waitUntil: 'domcontentloaded' });
        await page.type('#UsernameTB', BBM_USER);
        await page.type('#PasswordTB', BBM_PASS);
        await Promise.all([
            page.click('#LoginButton'),
            page.waitForNavigation({ waitUntil: 'networkidle2' })
        ]);

        console.log('   > Navigating to Ease Rankings...');
        const easeUrl = 'https://basketballmonster.com/easerankings.aspx'; // Correct URL
        await page.goto(easeUrl, { waitUntil: 'networkidle2' });

        // Iterate
        for (const pos of POSITIONS) {
            DB[pos.name] = {};

            // Switch Position
            const currentPos = await page.$eval('#ContentPlaceHolder1_PositionDropDownList', el => el.value);
            if (currentPos !== pos.value) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2' }),
                    page.select('#ContentPlaceHolder1_PositionDropDownList', pos.value)
                ]);
            }

            for (const range of RANGES) {
                DB[pos.name][range.name] = {};

                // Switch Timeframe
                const currentRange = await page.$eval('#DateFilterControl', el => el.value);
                if (currentRange !== range.value) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle2' }),
                        page.select('#DateFilterControl', range.value)
                    ]);
                }

                // Scrape
                const data = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table.datatable tbody tr'));
                    const result = {};
                    rows.forEach(r => {
                        const teamEl = r.cells[0]; // Corrected: Col 0 is 'vs Team'
                        if (!teamEl) return;

                        let teamRaw = teamEl.innerText.trim();
                        if (!teamRaw || teamRaw === 'Team' || teamRaw === 'vs Team') return;

                        // Clean "vs " prefix if present
                        teamRaw = teamRaw.replace(/^vs\s+/i, '').trim();

                        // TEAM MAPPING (BBM uses full names or odd abbr sometimes)
                        const TEAM_MAP_BBM = {
                            "Atl": "ATL", "Bos": "BOS", "Bkn": "BKN", "Cha": "CHA", "Chi": "CHI", "Cle": "CLE", "Dal": "DAL", "Den": "DEN", "Det": "DET", "GS": "GSW", "Hou": "HOU", "Ind": "IND", "LAC": "LAC", "LAL": "LAL", "Mem": "MEM", "Mia": "MIA", "Mil": "MIL", "Min": "MIN", "NO": "NOP", "NY": "NYK", "OKC": "OKC", "Orl": "ORL", "Phi": "PHI", "Pho": "PHO", "Por": "POR", "Sac": "SAC", "SA": "SAS", "Tor": "TOR", "Uta": "UTA", "Was": "WAS"
                        };
                        const team = TEAM_MAP_BBM[teamRaw] || teamRaw.toUpperCase();

                        const getVal = (idx) => {
                            const txt = r.cells[idx]?.innerText || '0';
                            return parseFloat(txt) || 0;
                        };

                        result[team] = {
                            pV: getVal(3), '3V': getVal(4), rV: getVal(5),
                            aV: getVal(6), sV: getVal(7), bV: getVal(8), toV: getVal(9)
                        };
                    });
                    return result;
                });
                DB[pos.name][range.name] = data;
            }
            console.log(`   ✅ Scraped ${pos.name}`);
        }

        // Save Cache
        fs.writeFileSync(EASE_DB_FILE, JSON.stringify(DB, null, 2));
        console.log(`   💾 Saved updated Ease DB.`);

    } catch (e) {
        console.error('   ❌ Ease Scrape Failed:', e.message);
        // Fallback to cache
        if (fs.existsSync(EASE_DB_FILE)) return JSON.parse(fs.readFileSync(EASE_DB_FILE));
    } finally {
        await browser.close();
    }
    return DB;
}

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
    const minKey = findKey(['min', 'mp', 'm/g']);
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
    const startPosKey = findKey(['start', 'start_pos']); // User Request: "Start" column
    const oddsKey = findKey(['odds']); // Needed for Parsing Totals

    // Extended Context (For Scoring Engine)
    const restKey = findKey(['rest']);
    const b2bKey = findKey(['b2b']);
    const ageKey = findKey(['age']);
    const l3Key = findKey(['3gg', 'l3', 'last 3']);
    const l5Key = findKey(['5gg', 'l5', 'last 5']);
    const usgKey = findKey(['usg', 'usg%', 'usage']);
    const valCKey = findKey(['valuec', 'val c', 'value c']);
    const pcKey = findKey(['pc', 'p cons', 'consistency']);
    const joshKey = findKey(['josh', 'joshg', 'josh g']);
    const jMinKey = findKey(['jming', 'jmin', 'josh min']);
    const jMaxKey = findKey(['jmaxg', 'jmax', 'josh max']);
    const lastMinKey = findKey(['last min', 'last mp', 'min last', 'prev min', 'lmin']);

    console.log(`[DEBUG] Keys Found: P=${pKey}, Min=${minKey}, Name=${nameKey}, Rest=${restKey}, B2B=${b2bKey}, Josh=${joshKey}`);

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

        // Parse Game Total from Odds (e.g. "O/U 225.0 -10.0")
        let gameTotal = 0;
        if (oddsKey) {
            const oddStr = String(row[oddsKey]);
            const match = oddStr.match(/O\/U\s+(\d+(\.\d+)?)/i);
            if (match) gameTotal = parseFloat(match[1]);
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
            gameTotal: gameTotal, // New Field
            projections: proj,
            // Extended Fields
            rest: restKey ? Number(row[restKey]) || 0 : 0,
            b2b: b2bKey ? Number(row[b2bKey]) || 0 : 0,
            age: ageKey ? (Number(row[ageKey]) || 25) : 25,
            val_3: l3Key ? Number(row[l3Key]) || 0 : 0,
            val_5: l5Key ? Number(row[l5Key]) || 0 : 0,
            usg: usgKey ? Number(row[usgKey]) || 0 : 0,
            valueC: valCKey ? Number(row[valCKey]) || 0 : 0,
            pc: pcKey ? Number(row[pcKey]) || 0 : 0,
            josh: joshKey ? Number(row[joshKey]) || 0 : 0,
            jMin: jMinKey ? Number(row[jMinKey]) || 0 : 0,
            jMax: jMaxKey ? Number(row[jMaxKey]) || 0 : 0,
            lastMin: lastMinKey ? Number(row[lastMinKey]) || 0 : 0,
            startPos: startPosKey ? String(row[startPosKey]).trim() : '' // New Field
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

// --- STEP 3a: FETCH GAME LOGS (SCORING ENGINE - L5 HIT RATE) ---
async function fetchGameLogs(browser) {
    console.log('📅 [Step 3a] Fetching Game Logs (Last 21 Days)...');
    const logs = {}; // { "Player Name": [ { date, pts, reb, ast, threes, blk, stl, to, min }, ... ] }
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    // Helper to format date
    const formatDate = (date) => {
        const d = new Date(date);
        return {
            M: d.getMonth() + 1,
            D: d.getDate(),
            Y: d.getFullYear(),
            str: d.toISOString().split('T')[0]
        };
    };

    // Iterate last 21 days (extended from 14 for better coverage)
    const today = new Date();
    for (let i = 1; i <= 21; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const { M, D, Y, str } = formatDate(d);
        const url = `https://www.basketball-reference.com/friv/dailyleaders.fcgi?month=${M}&day=${D}&year=${Y}`;

        try {
            console.log(`   > Fetching logs for ${str}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // Allow table to render
            await new Promise(r => setTimeout(r, 1500));

            const dailyStats = await page.evaluate((dateStr) => {
                const table = document.querySelector('#stats') || document.querySelector('.stats_table') || document.querySelector('table');
                if (!table) {
                    return `ERROR: No table found. Content: ${document.body.innerText.slice(0, 300).replace(/\n/g, ' ')}`;
                }
                const rows = Array.from(table.querySelectorAll('tbody tr'));
                const results = [];
                rows.forEach(row => {
                    if (row.classList.contains('thead')) return; // Skip headers
                    const nameEl = row.querySelector('td[data-stat="player"] a');
                    if (!nameEl) return;

                    // Normalize Name (Strip Accents & Dots)
                    // e.g. "Nikola Vučević" -> "Nikola Vucevic"
                    // e.g. "P.J. Washington" -> "PJ Washington"
                    let name = nameEl.innerText.trim();
                    name = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\./g, "");
                    const getVal = (stat) => parseFloat(row.querySelector(`td[data-stat="${stat}"]`)?.innerText || '0');

                    results.push({
                        name: name,
                        date: dateStr,
                        pts: getVal('pts'),
                        reb: getVal('trb'),
                        ast: getVal('ast'),
                        threes: getVal('fg3'),
                        blk: getVal('blk'),
                        stl: getVal('stl'),
                        to: getVal('tov'),
                        min: row.querySelector('td[data-stat="mp"]')?.innerText || '0:00'
                    });
                });
                return results;
            }, str);

            if (typeof dailyStats === 'string') {
                console.warn(`   ⚠️ ${dailyStats}`);
                continue;
            }

            console.log(`   > Extracted ${dailyStats.length} stats.`);

            // Merge into DB
            dailyStats.forEach(stat => {
                if (!logs[stat.name]) logs[stat.name] = [];
                logs[stat.name].push(stat);
            });

        } catch (err) {
            console.warn(`   ⚠️ Failed to fetch ${str}: ${err.message}`);
        }
    }

    await page.close();
    console.log(`✅ Game Logs Built. Covered ${Object.keys(logs).length} players.`);
    return logs;
}

// --- STEP 4: ANALYSIS ENGINE ---
async function analyzeMatchups(bbmPlayers, oddsData, easeDb, gameLogs) {
    console.log('🧠 [Step 4] Analyzing Matchups...');

    // Use passed Ease DB or fallback (safety)
    const EASE_DB = easeDb || {};

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

    // --- WEIGHTS TO NORMALIZE EDGE VALUE ---
    // Example: 1.0 steal edge is massive (x8), 1.0 point edge is small (x1)
    // --- WEIGHTS TO NORMALIZE EDGE VALUE ---
    // User Feedback (Jan 23): Steals/Blocks dominating top. 
    // Tuned down S/B from 6.0 -> 4.5 to allow Points/Reb/Ast to compete.
    const STAT_WEIGHTS = {
        'p': 1.0, 'pr': 1.0, 'pa': 1.0, 'pra': 1.0, 'ra': 1.0,
        'r': 1.2, 'a': 1.2,
        '3': 1.6,
        's': 4.5, 'b': 4.5, 'to': 3.0
    };

    // Iterate Players
    bbmPlayers.forEach(player => {
        if (player.min <= 22) return; // Strict Minute Filter (<= 22m)
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

            // --- PROPHET SCORING ENGINE (Ported from Server) ---
            const SETTINGS = {
                min_edge: 0.1,
                rest0_penalty: 0.05,
                b2b_penalty_young: 0.03,
                b2b_penalty_vet: 0.08,
                vet_age_threshold: 30,
                ease_weights: { "1w": 0.50, "2w": 0.30, "season": 0.20 }
            };

            // --- COMPLEX EASE CALCULATION ---
            let posEaseVal = 0;
            let teamEaseVal = 0;
            let activeEaseVal = 0;
            let easeBreakdown = "No Data";
            let narrative = []; // Initialize logic array

            const oppTeam = player.opp.replace(/[@vs]/g, '').trim().toUpperCase();

            // Map stat to Ease DB columns
            const componentStats = {
                'pr': ['pV', 'rV'],
                'pa': ['pV', 'aV'],
                'ra': ['rV', 'aV'],
                'pra': ['pV', 'rV', 'aV']
            };
            const comps = componentStats[stat] || [(stat === '3' ? '3V' : `${stat}V`)];

            if (Object.keys(EASE_DB).length > 0 && oppTeam) {
                const rawPos = player.pos || 'All';
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

                // User Logic for Positions:
                // 1. If "Start" column has a position, LOCK it.
                // 2. If "(V)" is in Start, it is verified exclusive.
                // 3. If no Start, use POS column. If multiple (PG,SG), AVERAGE them.

                let positionsToTest = [];
                const startRaw = player.startPos || '';

                if (startRaw) {
                    // Clean up "(V)" or verify notation
                    const cleanStart = startRaw.replace('(V)', '').replace('V', '').trim();
                    if (['PG', 'SG', 'SF', 'PF', 'C'].includes(cleanStart)) {
                        positionsToTest = [cleanStart];
                    }
                }

                if (positionsToTest.length === 0) {
                    // Fallback to POS column, split by space or comma
                    const pParts = (player.pos || 'All').split(/[\/, ]+/);
                    positionsToTest = pParts.filter(p => ['PG', 'SG', 'SF', 'PF', 'C'].includes(p));
                }

                if (positionsToTest.length === 0) positionsToTest = ['All'];

                // Calculate Positional Ease (Average if multiple)
                let posEaseSum = 0;
                positionsToTest.forEach(p => {
                    posEaseSum += calcWeighted(p);
                });
                posEaseVal = posEaseSum / positionsToTest.length;

                // 1. Team Matchup Ease (General Defense)
                teamEaseVal = calcWeighted('All');

                // NEW WEIGHTING: 85% Position (Far better indicator) + 15% Team
                activeEaseVal = (posEaseVal * 0.85) + (teamEaseVal * 0.15);

                // Format breakdown for UI (Color Coded - User Request)
                const pColor = posEaseVal > 0 ? '#4ade80' : (posEaseVal < 0 ? '#f87171' : '#cbd5e1');
                const tColor = teamEaseVal > 0 ? '#4ade80' : (teamEaseVal < 0 ? '#f87171' : '#cbd5e1');

                easeBreakdown = `Pos: <span style="color:${pColor}">${posEaseVal.toFixed(2)}</span> | Team: <span style="color:${tColor}">${teamEaseVal.toFixed(2)}</span>`;
            } else {
                // Fallback to BBM Ease if DB missing
                activeEaseVal = player.ease || 0;
            }

            let ease = activeEaseVal;


            // Dampened Confidence Formula (Calibrated Jan 21)
            // Was /8.5 -> Now /12.5 to prevent edge inflation
            let conf = 0.5 + (weightedEdge / 12.5);

            // --- CONTRADICTION PENALTY (Safety) & ALIGNMENT BONUS (Reward) ---
            if (side === 'UNDER') {
                if (activeEaseVal > 0.30) {
                    conf -= 0.12;
                    narrative.push(`⚠️ **Contradiction**: Betting UNDER against a soft defense (+${(activeEaseVal * 100).toFixed(1)}% Ease). <span style='color:#f87171'>(-12% Penalty)</span>`);
                } else if (activeEaseVal < -0.30) {
                    conf += 0.12;
                    narrative.push(`✅ **Smart Under**: Defense is elite (-${Math.abs(activeEaseVal * 100).toFixed(1)}% Ease). Supports the under. <span style='color:#4ade80'>(+12% Bonus)</span>`);
                }
            } else { // OVER
                if (activeEaseVal < -0.30) {
                    conf -= 0.12;
                    narrative.push(`⚠️ **Contradiction**: Betting OVER against a tough defense (-${Math.abs(activeEaseVal * 100).toFixed(1)}% Ease). <span style='color:#f87171'>(-12% Penalty)</span>`);
                } else if (activeEaseVal > 0.30) {
                    conf += 0.12;
                    narrative.push(`✅ **Smart Over**: Defense is soft (+${(activeEaseVal * 100).toFixed(1)}% Ease). Supports the over. <span style='color:#4ade80'>(+12% Bonus)</span>`);
                }
            }

            // --- CONFIDENCE CAPS (The "Realism" Ceiling) ---
            let maxCap = 0.99; // Default Max (A+)

            // 1. Back-to-Back Cap (Max 92% - No Locks)
            if (player.b2b >= 1) maxCap = Math.min(maxCap, 0.92);

            // 2. Negative Ease Cap (Max 90% - A-)
            // If betting Over into bad ease, or Under into good ease
            if ((side === 'OVER' && activeEaseVal < -0.15) || (side === 'UNDER' && activeEaseVal > 0.15)) {
                maxCap = Math.min(maxCap, 0.90);
            }

            // 3. Blowout Risk Cap (Tightened Jan 23 - User Request)
            const gameSpread = (lines && lines.length > 0) ? (lines[0].gameSpread || 0) : 0;
            if (Math.abs(gameSpread) >= 10.5 && side === 'OVER') {
                conf -= 0.10; // Increased penalty to 10%
                narrative.push(`⚠️ **Game Script**: ${gameSpread}pt spread implies a blowout. Size down for 4th qtr risk.`);
            }

            // 4. Rotation Volatility (User Request: Jan 23)
            // If Projected Min is > 6 mins higher than Last Actual Min, risk of benching.
            const lastMin = player.lastMin || 0;
            const projMin = player.min || 0;
            if (lastMin > 0 && (projMin - lastMin) >= 6) {
                conf -= 0.08; // -8% Penalty
                narrative.push(`⚠️ **Rotation Risk**: Projected for ${projMin}m but only played ${lastMin}m last game. Volatile role.`);
            }

            // Penalties (Rest, Age) - Apply to base confidence
            if (player.rest === 0) conf -= SETTINGS.rest0_penalty;
            if (player.b2b >= 1) {
                if ((player.age || 25) >= SETTINGS.vet_age_threshold) {
                    conf -= SETTINGS.b2b_penalty_vet;
                } else {
                    conf -= SETTINGS.b2b_penalty_young;
                }
            }

            // --- PACE / GAME ENVIRONMENT LOGIC ---
            // High Total (>232) -> Boost Overs, Penalty Unders
            // Low Total (<218) -> Boost Unders, Penalty Overs
            if (player.gameTotal > 0) {
                if (player.gameTotal >= 232.0) {
                    if (side === 'OVER') {
                        conf += 0.05;
                        narrative.push(`🔥 **Track Meet**: High Vegas Total (${player.gameTotal}) favors scoring environment.`);
                    } else {
                        conf -= 0.05;
                    }
                } else if (player.gameTotal <= 218.0) {
                    if (side === 'UNDER') {
                        conf += 0.05;
                        narrative.push(`🐌 **Grind-it-out**: Low Vegas Total (${player.gameTotal}) suggests limited opportunities.`);
                    } else {
                        conf -= 0.05;
                    }
                }
            }

            // --- APPLY CAPS ---
            if (conf > maxCap) conf = maxCap;


            // --- L5 HIT RATE LOGIC (NEW) ---
            let l5Bonus = 0;
            let l5Narrative = "";

            // Normalize name key for lookup
            const logKey = Object.keys(gameLogs).find(k => k.toLowerCase() === player.name.toLowerCase()) || player.name;
            const pLogs = gameLogs[logKey];

            if (pLogs && pLogs.length > 0) {
                // Sort by date desc just in case
                const recentLogs = pLogs.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

                let hits = 0;
                let validGames = 0;

                // Stat Mapping
                const statMap = { 'p': 'pts', 'r': 'reb', 'a': 'ast', '3': 'threes', 's': 'stl', 'b': 'blk', 'to': 'to' };
                let logStat = statMap[stat];
                let isCombo = false;

                // Handle Combined Stats
                if (['pra', 'pr', 'pa', 'ra'].includes(stat)) {
                    isCombo = true;
                }

                if (logStat || isCombo) {
                    const values = [];
                    recentLogs.forEach(g => {
                        let val = 0;
                        if (isCombo) {
                            if (stat.includes('p')) val += (g.pts || 0);
                            if (stat.includes('r')) val += (g.reb || 0);
                            if (stat.includes('a')) val += (g.ast || 0);
                        } else {
                            val = g[logStat];
                        }

                        if (val !== undefined && val !== null) { // null check
                            validGames++;
                            values.push(val);
                            if (side === 'OVER' && val > line) hits++;
                            if (side === 'UNDER' && val < line) hits++;
                        }
                    });

                    if (validGames >= 3) { // Require at least 3 games
                        const avgStr = (values.reduce((a, b) => a + b, 0) / validGames).toFixed(1);

                        // 0/5 Hits -> Disqualify
                        if (hits === 0 && validGames === 5) {
                            return; // DISQUALIFY: User Logic "0 of 5 = not a qualifying pick"
                        }

                        // Multipliers (Applied to Confidence, which scales Prophet Points directly)
                        let l5Multiplier = 1.0;
                        let icon = "";
                        let sentiment = "";

                        if (hits === 5) {
                            l5Multiplier = 1.20; // +20%
                            icon = "🔥";
                            sentiment = "Perfect Form";
                        } else if (hits === 4) {
                            l5Multiplier = 1.15; // +15%
                            icon = "🔥";
                            sentiment = "Strong Form";
                        } else if (hits === 3) {
                            l5Multiplier = 1.0; // Neutral
                            icon = "➡️";
                            sentiment = "Steady";
                        } else if (hits === 2) {
                            l5Multiplier = 0.90; // -10%
                            icon = "⚠️";
                            sentiment = "Shaky Form";
                        } else if (hits === 1) {
                            l5Multiplier = 0.85; // -15%
                            icon = "❄️";
                            sentiment = "Cold/Risky";
                        }

                        // Apply Multiplier
                        conf *= l5Multiplier;

                        // Narrative - ALWAYS show if we have valid games
                        if (validGames >= 3) {
                            const bonusStr = (l5Multiplier > 1) ? `(+${Math.round((l5Multiplier - 1) * 100)}% Bonus)` :
                                (l5Multiplier < 1) ? `(${Math.round((l5Multiplier - 1) * 100)}% Penalty)` :
                                    "(No Adjustment)";
                            const hitStr = `${hits}/${validGames}`;
                            const color = (l5Multiplier > 1) ? '#4ade80' : (l5Multiplier < 1) ? '#f87171' : '#cbd5e1';
                            l5Narrative = `${icon} **Last 5 Games**: ${sentiment} (${hitStr} Hits). Avg: ${avgStr}. <span style='color:${color}'>${bonusStr}</span>`;
                        }
                    }
                }
            }
            conf += l5Bonus;

            // Value C (Global Impact)
            const valC = player.valueC || 0;
            if (valC >= 1.5 && side === 'OVER') conf += 0.04;
            else if (valC <= -1.5 && side === 'OVER') conf -= 0.04;

            // Josh G (Sharp Input)
            const josh = player.josh || 0;
            const jMin = player.jMin || 0;
            const jMax = player.jMax || 0;
            if (josh >= 1.5 && side === 'OVER') conf += 0.06;
            else if (josh <= -1.5 && side === 'UNDER') conf += 0.06;

            if (side === 'OVER' && jMin > -1.0) conf += 0.03;
            if (side === 'UNDER' && jMax < 1.0) conf += 0.03;

            // Clamp Confidence
            conf = Math.max(0.01, Math.min(0.99, conf));

            // Confidence Grading (Stricter Thresholds)
            let confGrade = "D";
            if (conf >= 0.94) confGrade = "A+ 🌟"; // Was 0.90
            else if (conf >= 0.88) confGrade = "A"; // Was 0.85
            else if (conf >= 0.82) confGrade = "A-"; // Was 0.80
            else if (conf >= 0.76) confGrade = "B+"; // Was 0.75
            else if (conf >= 0.70) confGrade = "B";
            else if (conf >= 0.60) confGrade = "C";

            // Final Prophet Points Calculation
            // SQUARED CONFIDENCE: Rewards high confidence exponentially.
            // Addresses User feedback: 9.9 (73%) should NOT beat 9.5 (99%).
            // With Square: 0.73^2 = 0.53 multiplier vs 0.99^2 = 0.98 multiplier.
            const prophetPoints = (weightedEdge * (conf * conf) * 3.0).toFixed(2);

            // Tier Logic
            const ppt = parseFloat(prophetPoints);
            // Relax filter slightly to allow testing
            if (ppt < 4.0) return;

            let betRating = "✅ SOLID PLAY";
            if (ppt >= 10.5) betRating = "🔒 PROPHET LOCK";
            else if (ppt >= 9.0) betRating = "💎 DIAMOND BOY";
            else if (ppt >= 8.0) betRating = "🔥 ELITE";
            else if (ppt >= 7.0) betRating = "💪 STRONG PLAY";

            // Gates (Minutes/Rookie)
            const min = player.min || 0;
            const status = (player.status || '').toLowerCase();
            let capAtStrong = false;

            if (min < 23) capAtStrong = true;
            if (status.includes('rookie') && (min < 23)) capAtStrong = true;

            if (capAtStrong) {
                if (betRating.includes("LOCK") || betRating.includes("DIAMOND") || betRating.includes("ELITE")) {
                    betRating = "💪 STRONG PLAY";
                }
            }

            // Narrative Generation
            const displayStat = {
                'p': 'Points', 'r': 'Rebounds', 'a': 'Assists', '3': 'Threes', 's': 'Steals', 'b': 'Blocks', 'to': 'Turnovers',
                'pr': 'Pts+Reb', 'pa': 'Pts+Ast', 'ra': 'Reb+Ast', 'pra': 'Pts+Reb+Ast'
            }[stat] || stat.toUpperCase();

            // 1. THE OPENER
            if (weightedEdge > 8.0) narrative.push(`💎 **Massive Discrepancy**: The model prices this at ${proj.toFixed(1)}, giving us a massive **${edge.toFixed(2)} unit cushion** vs the market.`);
            else if (weightedEdge > 5.0) narrative.push(`💰 **Value Play**: We are capturing **${edge.toFixed(2)} points of implied value** here.`);
            else narrative.push(`🎯 **Solid Edge**: Model identifies a **${edge.toFixed(2)} point gap** vs public perception.`);

            // 2. THE MATCHUP
            const formattedEase = (activeEaseVal * 100).toFixed(1) + '%';
            if (activeEaseVal >= 0.20) {
                if (side === 'OVER') {
                    narrative.push(`✅ **Smash Spot**: ${oppTeam} defense is bleeding ${displayStat} to this position (+${formattedEase} Ease). High ceiling environment.`);
                } else {
                    narrative.push(`⚠️ **Dangerous Matchup**: ${oppTeam} allows high production (+${formattedEase} Ease). Risky spot for an Under.`);
                }
            } else if (activeEaseVal <= -0.20) {
                if (side === 'UNDER') {
                    narrative.push(`🔒 **Defensive Clamp**: ${oppTeam} ranks elite vs ${displayStat} (${formattedEase} Ease). Expect usage to struggle.`);
                } else {
                    narrative.push(`⚠️ **Tough Grind**: ${oppTeam} is elite vs ${displayStat} (${formattedEase} Ease). Player will need volume to hit.`);
                }
            } else if (Math.abs(activeEaseVal) < 0.10) {
                narrative.push(`⚖️ **Neutral Spot**: Matchup is average, but the volume projection (${proj.toFixed(1)}) carries the play.`);
            }

            // 3. THE FORM (L5)
            if (l5Narrative) narrative.push(l5Narrative);

            // 4. THE RISKS & SHARP SIGNALS
            if (Math.abs(gameSpread) >= 10) narrative.push(`⚠️ **Game Script**: ${gameSpread}pt spread implies a blowout. Size down slightly for 4th qtr sitting risk.`);
            if (player.b2b >= 1) narrative.push(`⚠️ **Back-to-Back**: Player is on 0 days rest. Fatigue penalty applied.`);
            if (capAtStrong) narrative.push(`⚠️ **Minute Restrictions**: Player minutes volatile or rookie status. Downgraded to STRONG.`);

            if (player.josh > 1.0) narrative.push(`🦈 **Sharp Action**: 'Josh G' indicators signal smart money is backing this play.`);


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
                posEase: posEaseVal,
                teamEase: teamEaseVal,
                usg: player.usg,
                marketLine: `${line}`,
                betRating: betRating,
                confidence: conf,
                confidenceGrade: confGrade,
                score: prophetPoints,
                interpretation: `Matchup: ${interpret(ease, stat, side)} | ${easeBreakdown}`,
                analysis: deepAnalysis,
                startTime: (lines && lines.length > 0 && lines[0].startTime) ? lines[0].startTime : player.startTime
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

        // 3a. Rebuild Ease DB (NOW SCRAPED)
        const easeDb = await fetchBBMEase();

        // 3b. Fetch Game Logs (NEW)
        console.log('🚀 Launching browser for Game Log Scraper...');
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }); // Fixed: explicit launch with CI args
        const gameLogs = await fetchGameLogs(browser);
        await browser.close();

        // 4. Analyze Matchups
        console.log('🧠 [Step 4] Starting Analysis Engine...');
        const picks = await analyzeMatchups(players, odds, easeDb, gameLogs);

        console.log(`✅ Generated ${picks.length} picks.`);

        // --- HISTORY TRACKING ---
        let history = loadHistory();
        history = resolveHistory(history, gameLogs); // Always resolve/grade existing picks

        // Find earliest start time
        const earliest = picks.reduce((min, p) => {
            const t = new Date(p.startTime).getTime();
            return (t > 0 && t < min) ? t : min;
        }, Infinity);

        let minutesUntilTip = -1;
        if (earliest !== Infinity) {
            const now = new Date().getTime();
            minutesUntilTip = (earliest - now) / 60000;
            console.log(`⏱️ Earliest Tip-Off in ${minutesUntilTip.toFixed(1)} mins`);
        }

        // Logic: Only snapshot (lock in) picks if we are close to tip-off (e.g. 35 mins or less)
        // User requested "20 mins before". Given hourly trigger, 0-40 mins window is safe.
        // We also allow negative overlap (e.g. -5 mins) just in case script is slightly late.
        if (minutesUntilTip <= 40 && minutesUntilTip > -10) {
            console.log(`🔒 LOCK WINDOW ACTIVE: Snapshotting picks to History...`);
            history = updateHistory(history, picks);
        } else {
            console.log(`⏳ No Commit: Outside Lock Window (Needs to be <= 40m before tip).`);
        }

        const recordStats = generateStats(history);
        // ------------------------

        // 5. Save
        const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const content = `window.LAST_UPDATED = "${timestamp}";\nwindow.PROPHET_RECORD = ${JSON.stringify(recordStats, null, 2)};\nwindow.LATEST_PICKS = ${JSON.stringify(picks, null, 2)};`;
        fs.writeFileSync(OUTPUT_FILE, content);
        console.log(`💾 Saved to ${OUTPUT_FILE}`);

    } catch (err) {
        console.error('❌ FATAL ERROR:', err);
        process.exit(1);
    }
})();

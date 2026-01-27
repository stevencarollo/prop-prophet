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
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER; // Default to self
// const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID; // REMOVED
// const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN; // REMOVED
// const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER; // REMOVED

const DOWNLOAD_DIR = path.join(__dirname, '..');
const BBM_LOGIN_URL = 'https://basketballmonster.com/login.aspx';
const BBM_DATA_URL = 'https://basketballmonster.com/dailyprojections.aspx';

const EASE_DB_FILE = path.join(__dirname, '../ease_rankings.json');
const OUTPUT_FILE = path.join(__dirname, '../latest_picks_live.js');
const HISTORY_FILE = path.join(__dirname, '../history/prophet_history.json');
const ALERTS_FILE = path.join(__dirname, '../history/prophet_alerts.json');
const nodemailer = require('nodemailer');

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
                if (pick.stat.includes('r')) actual += game.reb;
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
                    updated++;
                }

                history[existingIndex].tier = p.betRating;
                history[existingIndex].line = p.line;
                history[existingIndex].side = p.side;
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
        if (h.result === 'PENDING' || h.result === 'PUSH') return;

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

                        // TEAM MAPPING
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
        headless: "new",
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
        await delay(15000);

        // Find file
        const newFiles = fs.readdirSync(DOWNLOAD_DIR)
            .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'))
            .map(f => ({ name: f, time: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

        if (newFiles.length === 0) throw new Error('Download failed - no file found.');

        const latestFile = path.join(DOWNLOAD_DIR, newFiles[0].name);
        console.log(`✅ Downloaded: ${newFiles[0].name}`);
        const fileBuffer = fs.readFileSync(latestFile);

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
    const startPosKey = findKey(['start', 'start_pos']);
    const oddsKey = findKey(['odds']);

    // Extended
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
            gameTotal: gameTotal,
            projections: proj,
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
            startPos: startPosKey ? String(row[startPosKey]).trim() : ''
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

// --- STEP 3a: FETCH GAME LOGS ---
async function fetchGameLogs(browser) {
    console.log('📅 [Step 3a] Fetching Game Logs (Last 21 Days)...');
    const logs = {};
    const page = await browser.newPage();
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
    for (let i = 1; i <= 21; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const { M, D, Y, str } = formatDate(d);
        const url = `https://www.basketball-reference.com/friv/dailyleaders.fcgi?month=${M}&day=${D}&year=${Y}`;

        try {
            console.log(`   > Fetching logs for ${str}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 1500));

            const dailyStats = await page.evaluate((dateStr) => {
                const table = document.querySelector('#stats') || document.querySelector('.stats_table') || document.querySelector('table');
                if (!table) return `ERROR: No table found.`;

                const rows = Array.from(table.querySelectorAll('tbody tr'));
                const results = [];
                rows.forEach(row => {
                    if (row.classList.contains('thead')) return;
                    const nameEl = row.querySelector('td[data-stat="player"] a');
                    if (!nameEl) return;

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
    const EASE_DB = easeDb || {};
    const oddsMap = new Map();

    oddsData.forEach(game => {
        game.bookmakers.forEach(book => {
            book.markets.forEach(mkt => {
                mkt.outcomes.forEach(out => {
                    let pName = out.description || out.name;
                    if (out.name === 'Over' || out.name === 'Under') pName = out.description;
                    else pName = out.description || out.name;

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

    const STAT_WEIGHTS = {
        'p': 1.0, 'pr': 1.0, 'pa': 1.0, 'pra': 1.0, 'ra': 1.0,
        'r': 1.2, 'a': 1.2,
        '3': 1.6,
        's': 4.5, 'b': 4.5, 'to': 3.0
    };

    bbmPlayers.forEach(player => {
        if (player.min <= 22) return;
        if (player.injury && player.injury.toLowerCase().includes('out')) return;

        Object.keys(player.projections).forEach(stat => {
            const mktKey = STAT_MAP[stat];
            if (!mktKey) return;

            const proj = player.projections[stat];
            if (proj < 1.0 && !['s', 'b', 'to'].includes(stat)) return;

            const exactKey = `${player.name_norm}|${mktKey}`;
            let lines = oddsMap.get(exactKey);
            if (!lines) return;

            const calcLine = lines.reduce((acc, v) => acc + v.point, 0) / lines.length;
            const line = Math.round(calcLine * 2) / 2;

            let edge = 0;
            let side = 'OVER';
            if (stat === 'to') {
                if (line > proj) { side = 'UNDER'; edge = line - proj; }
                else { side = 'OVER'; edge = proj - line; }
            } else {
                if (proj > line) { side = 'OVER'; edge = proj - line; }
                else { side = 'UNDER'; edge = line - proj; }
            }

            const weight = STAT_WEIGHTS[stat] || 1.0;
            const weightedEdge = edge * weight;

            if (weightedEdge < 1.0 && stat !== 'to') return;
            if (stat === 'to' && weightedEdge < 1.5) return;

            // EASE CALC
            const posCode = player.pos.substring(0, 2);
            const team = player.team;
            let teamEase = 0;
            let posEase = 0;

            const oppCode = player.opp.toUpperCase();
            if (EASE_DB.All && EASE_DB.All.LastTwoWeeks && EASE_DB.All.LastTwoWeeks[oppCode]) {
                const mapBBM = { 'p': 'pV', '3': '3V', 'r': 'rV', 'a': 'aV', 's': 'sV', 'b': 'bV', 'to': 'toV' };
                let easeKey = mapBBM[stat];
                if (!easeKey) {
                    if (stat === 'pr') easeKey = ['pV', 'rV'];
                    if (stat === 'pa') easeKey = ['pV', 'aV'];
                    if (stat === 'ra') easeKey = ['rV', 'aV'];
                    if (stat === 'pra') easeKey = ['pV', 'rV', 'aV'];
                }

                const calcAvgEase = (source, keys) => {
                    if (Array.isArray(keys)) {
                        return keys.reduce((s, k) => s + (source[k] || 0), 0) / keys.length;
                    }
                    return source[keys] || 0;
                };

                const teamData = EASE_DB.All.LastTwoWeeks[oppCode];
                teamEase = calcAvgEase(teamData, easeKey);

                if (EASE_DB[posCode] && EASE_DB[posCode].LastTwoWeeks && EASE_DB[posCode].LastTwoWeeks[oppCode]) {
                    const posData = EASE_DB[posCode].LastTwoWeeks[oppCode];
                    posEase = calcAvgEase(posData, easeKey);
                }
            }

            let easeScore = (teamEase + posEase) / 2;
            if (side === 'UNDER') easeScore = -easeScore;

            // SCORE
            let score = weightedEdge;

            // Ease Modifier
            if (easeScore > 0.30) { score *= 1.12; } // +12% Bonus
            else if (easeScore < -0.40) { score *= 0.65; } // -35% Penalty

            // Rotation Volatility
            if (player.lastMin > 0 && player.min > (player.lastMin + 6)) {
                score *= 0.90; // -10% Penalty (Rotation Risk)
            }

            // Blowout Risk
            if (player.gameTotal > 0 && Math.abs(player.gameTotal) > 10.5) {
                score *= 0.90; // -10% Penalty
            }

            // Confidence
            let confidence = 0.5;
            if (score > 4) confidence = 0.6;
            if (score > 6) confidence = 0.75;
            if (score > 8) confidence = 0.85;
            if (score > 10) confidence = 0.92;

            if (easeScore > 0.25) confidence += 0.05;
            if (easeScore < -0.20) confidence -= 0.15;

            // Blowout Penalty (Confidence)
            if (Math.abs(player.gameTotal) > 13.5) confidence -= 0.08;

            let confGrade = 'C';
            if (confidence > 0.90) confGrade = 'A+ 🌟';
            else if (confidence > 0.80) confGrade = 'A';
            else if (confidence > 0.70) confGrade = 'B';

            let betRating = '✅ SOLID PLAY';
            if (score > 7) betRating = '💪 STRONG PLAY';
            if (score > 8) betRating = '🔥 ELITE';
            if (score > 9) betRating = '💎 DIAMOND';
            if (score > 10.5) betRating = '🔒 PROPHET LOCK';

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
                ease: easeScore,
                posEase: posEase,
                teamEase: teamEase,
                usg: player.usg,
                marketLine: lines[0].point.toString(),
                betRating: betRating,
                confidence: confidence,
                confidenceGrade: confGrade,
                score: score.toFixed(2),
                interpretation: interpret(easeScore, stat, side),
                analysis: "",
                startTime: lines[0].startTime
            });
        });
    });

    return results.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
}

// --- MAIN WORKFLOW ---
(async () => {
    try {
        console.log('🚀 Starting Prophet Daily Workflow...');

        // 1. Load History
        let history = loadHistory();

        // 1b. Fetch Game Logs & Resolve History
        const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
        const gameLogs = await fetchGameLogs(browser);
        await browser.close();

        history = resolveHistory(history, gameLogs);

        // 2. Download & Parse
        const bbmBuffer = await downloadBBM();
        const bbmPlayers = parseBBM(bbmBuffer);

        // 3. Fetch Ease (Step 3b)
        const easeDb = await fetchBBMEase();

        // 4. Fetch Odds
        const oddsData = await fetchOdds();

        // 5. Analyze
        const allPicks = await analyzeMatchups(bbmPlayers, oddsData, easeDb, gameLogs);

        // 6. Filter & Format
        const topPicks = allPicks.filter(p => parseFloat(p.score) > 4.5);

        // Generate Narratives
        topPicks.forEach(p => {
            let narrative = "";
            const easePct = (p.ease * 100).toFixed(1);

            // Ease Narrative
            if (p.ease > 0.10) {
                narrative += `✅ **Smart Over**: Defense is soft (+${easePct}% Ease). Supports the over. <span style='color:#4ade80'>(+12% Bonus)</span><br>`;
            } else if (p.ease < -0.10) {
                narrative += `⚠️ **Tough Matchup**: Defense is stingy (${easePct}% Ease). Tread carefully. <span style='color:#f87171'>(-35% Penalty)</span><br>`;
            }

            // Game Total Narrative
            if (p.gameTotal > 230) {
                narrative += `🔥 **Track Meet**: High Vegas Total (${p.gameTotal}) favors scoring environment.<br>`;
            } else if (p.gameTotal < 210 && p.gameTotal > 0) {
                narrative += `🧊 **Grind It Out**: Low Vegas Total (${p.gameTotal}) suggests slower pace.<br>`;
            }

            // Edge Narrative
            narrative += `🎯 **Solid Edge**: Model identifies a **${p.edge} point gap** vs public perception.<br>`;

            // L5 Narrative (from Game Logs)
            const logKey = Object.keys(gameLogs).find(k => k.toLowerCase() === p.player.toLowerCase());
            if (logKey) {
                const logs = gameLogs[logKey].slice(0, 5); // Last 5
                let hits = 0;
                let sum = 0;
                logs.forEach(g => {
                    // Calc stat
                    const statMap = { 'p': 'pts', 'r': 'reb', 'a': 'ast', '3': 'threes', 's': 'stl', 'b': 'blk', 'to': 'to' };
                    const logStat = statMap[p.stat];
                    let val = 0;
                    if (['pra', 'pr', 'pa', 'ra'].includes(p.stat)) {
                        if (p.stat.includes('p')) val += g.pts;
                        if (p.stat.includes('r')) val += g.reb;
                        if (p.stat.includes('a')) val += g.ast;
                    } else {
                        val = g[logStat];
                    }
                    sum += val;
                    if (p.side === 'OVER' && val > p.line) hits++;
                    if (p.side === 'UNDER' && val < p.line) hits++;
                });
                const avg = (sum / 5).toFixed(1);

                if (hits >= 4) narrative += `🔥 **Last 5 Games**: Strong Form (${hits}/5 Hits). Avg: ${avg}. <span style='color:#4ade80'>(+15% Bonus)</span>`;
                else if (hits <= 1) narrative += `⚠️ **Last 5 Games**: Shaky Form (${hits}/5 Hits). Avg: ${avg}. <span style='color:#f87171'>(-10% Penalty)</span>`;
                else narrative += `➡️ **Last 5 Games**: Steady (${hits}/5 Hits). Avg: ${avg}. <span style='color:#cbd5e1'>(No Adjustment)</span>`;
            }

            // Smash Spot
            if (p.ease > 0.50) {
                const statLabel = p.stat.toUpperCase().replace('P', 'Points').replace('R', 'Reb').replace('A', 'Ast');
                narrative += `<br>✅ **Smash Spot**: ${p.opp} defense is bleeding ${statLabel} to this position (+${easePct}% Ease). High ceiling environment.`;
            }

            // Rotation Volatility
            if (narrative.includes("Rotation Risk")) {
                narrative += `<br>⚠️ **Rotation Risk**: Projected minutes (${p.min}) match recent workloads.`;
            }

            p.analysis = narrative;
        });

        // 7. Update History with NEW picks
        history = updateHistory(history, topPicks);

        // 8. Generate Record (Stats)
        const record = generateStats(history);

        // 9. Output to File
        const outputContent = `window.LAST_UPDATED = "${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}";\n` +
            `window.PROPHET_RECORD = ${JSON.stringify(record, null, 2)};\n` +
            `window.LATEST_PICKS = ${JSON.stringify(topPicks, null, 2)};`;

        fs.writeFileSync(OUTPUT_FILE, outputContent);
        console.log(`✅ Success! Updated ${OUTPUT_FILE} with ${topPicks.length} picks.`);

        // --- NOTIFICATION SYSTEM ---
        const ALERTS_FILE = path.join(__dirname, '../history/prophet_alerts.json');
        let sentIds = [];
        try {
            if (fs.existsSync(ALERTS_FILE)) {
                sentIds = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
            }
        } catch (e) { }

        // Filter for NEW Unique Locks
        // Logic: Must be "PROPHET LOCK", Must NOT be in sentIds
        const newLocks = topPicks.filter(p =>
            p.betRating === '🔒 PROPHET LOCK' &&
            !sentIds.includes(`${p.player}-${p.stat}-${p.line}`) // Check if exactly this bet was sent
            // Actually, best to use the generated ID logic? 
            // Let's use simple logic: If we haven't alerted this Player+Stat this cycle.
        ).map(p => ({
            ...p,
            id: `${p.player}-${p.stat}-${p.line}` // Simple ID
        })).filter(p => !sentIds.includes(p.id));

        // Deduplicate (e.g. don't send 2 emails for same player if multiple lines hit)
        const uniqueLocks = [];
        const seenInBatch = new Set();
        const sanitize = (n) => n.toLowerCase().replace(/[^a-z]/g, '');

        for (const p of newLocks) {
            const pName = sanitize(p.player);
            if (!seenInBatch.has(pName)) {
                uniqueLocks.push(p);
                seenInBatch.add(pName);
            }
        }

        if (uniqueLocks.length === 0) {
            console.log('📭 No NEW (Unique) Prophet Locks to alert.');
            return;
        }

        console.log(`📧 Found ${uniqueLocks.length} NEW Unique Locks! Sending email...`);

        // Setup Transporter (Gmail)
        let transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            }
        });

        // Load Subscribers
        const SUBSCRIBERS_FILE = path.join(__dirname, '../history/subscribers.json');
        let recipients = [EMAIL_TO]; // Default to admin
        if (fs.existsSync(SUBSCRIBERS_FILE)) {
            const subs = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
            if (Array.isArray(subs) && subs.length > 0) {
                recipients = subs;
            }
        }

        console.log(`📧 Sending to ${recipients.length} subscribers...`);

        // Build Email Body
        let html = `<h2>🚀 New Prophet Locks Detected!</h2>`;
        uniqueLocks.forEach(p => {
            html += `
            <div style="border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 8px;">
                <h3 style="color: #10b981;">${p.player} (${p.team})</h3>
                <p><strong>Pick:</strong> ${p.stat} ${p.side} ${p.line}</p>
                <p><strong>Score:</strong> ${p.score} 💎</p>
                <p><strong>Edge:</strong> ${p.edge}%</p>
                <p><em>"${p.interpretation}"</em></p>
            </div>
            `;
        });
        html += `<p><a href="https://prop-prophet.vercel.app">View Dashboard</a></p>`;

        // Send
        try {
            await transporter.sendMail({
                from: `"Prophet Bot" <${EMAIL_USER}>`,
                bcc: recipients, // Use BCC for privacy
                subject: `🔒 ${uniqueLocks.length} New Prophet Lock(s)!`,
                html: html
            });
            console.log('✅ Email sent successfully!');

            // --- SMS ALERT SYSTEM (Jan 27) ---
            // Option A: Email-to-SMS Gateway
            const SMS_FILE = path.join(__dirname, '../history/sms_subscribers.json');
            if (fs.existsSync(SMS_FILE)) {
                const smsList = JSON.parse(fs.readFileSync(SMS_FILE, 'utf8'));
                if (smsList.length > 0) {
                    console.log(`📱 Sending Text-Emails to ${smsList.length} numbers...`);

                    const firstLock = uniqueLocks[0];
                    const txtBody = `🔒 PROPHET LOCK: ${firstLock.player} (${firstLock.team}) ${firstLock.stat.toUpperCase()} ${firstLock.side} ${firstLock.line}. Edge: ${firstLock.edge} units. Conf: ${(firstLock.confidence * 100).toFixed(0)}%. Analysis: prop-prophet.vercel.app`;

                    for (const recipient of smsList) {
                        try {
                            await transporter.sendMail({
                                from: `"Prophet Bot" <${EMAIL_USER}>`,
                                to: recipient,
                                subject: "",
                                text: txtBody
                            });
                            console.log(`   -> Sent to ${recipient}`);
                        } catch (smsErr) {
                            console.error(`   ❌ Failed to SMS-Email ${recipient}:`, smsErr.message);
                        }
                    }
                }
            }

            // Update History (Add the IDs of the sent ones)
            uniqueLocks.forEach(p => sentIds.push(p.id));
            fs.writeFileSync(ALERTS_FILE, JSON.stringify(sentIds, null, 2));

        } catch (err) {
            console.error('❌ Failed to send email:', err);
        }

    } catch (err) {
        console.error('❌ Workflow Failed:', err);
        process.exit(1);
    }
})();

const fetch = require('node-fetch');

async function test() {
    // Current Season? 2025-26 based on user context
    const url = "https://stats.nba.com/stats/playergamelogs?Counter=1000&DateFrom=01/05/2026&DateTo=01/19/2026&Direction=DESC&LeagueID=00&PlayerOrTeam=P&Season=2025-26&SeasonType=Regular%20Season&Sorter=DATE";

    // Headers are critical for stats.nba.com
    const headers = {
        "Referer": "https://www.nba.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Origin": "https://www.nba.com/",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true"
    };

    try {
        console.log("Fetching logic...");
        const res = await fetch(url, { headers });
        console.log("Status:", res.status);
        const text = await res.text();
        console.log("Preview:", text.slice(0, 500));
    } catch (e) {
        console.error("Failed:", e);
    }
}

test();

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const MARKET_API_KEY = process.env.MARKET_API_KEY;

function normalizeName(n) {
    if (!n) return '';
    return n.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

(async () => {
    // 1. Fetch Events
    const evUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${MARKET_API_KEY}`;
    const r = await fetch(evUrl);
    const events = await r.json();
    console.log(`Events Found: ${events.length}`);

    if (events.length > 0) {
        const game = events[0];
        console.log(`Inspecting Game: ${game.home_team} vs ${game.away_team} (ID: ${game.id})`);

        // 2. Fetch Props
        const propsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${game.id}/odds?regions=us&markets=player_points&oddsFormat=american&apiKey=${MARKET_API_KEY}`;
        const r2 = await fetch(propsUrl);
        const props = await r2.json();

        console.log('Props Response Sample:', JSON.stringify(props).slice(0, 500));

        if (props.bookmakers && props.bookmakers.length > 0) {
            console.log(`Bookmakers Found: ${props.bookmakers.length}`);
            console.log(`First Book: ${props.bookmakers[0].title}`);
            console.log(`Outcomes: ${JSON.stringify(props.bookmakers[0].markets[0].outcomes.slice(0, 2))}`);
        } else {
            console.log('⚠️ No Bookmakers found for this game (Odds might be empty or quota exceeded)');
        }
    }
})();

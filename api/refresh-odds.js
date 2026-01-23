// Vercel Serverless Function - Refresh Odds On-Demand
const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const MARKET_API_KEY = process.env.MARKET_API_KEY;

    if (!MARKET_API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    try {
        console.log('[Vercel Function] Fetching fresh odds...');

        // 1. Fetch NBA events
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${MARKET_API_KEY}`;
        const eventsResp = await fetch(eventsUrl);

        if (!eventsResp.ok) {
            throw new Error('Failed to fetch events');
        }

        const events = await eventsResp.json();
        const now = Date.now();
        const activeEvents = events.filter(e => new Date(e.commence_time).getTime() > now);

        console.log(`[Vercel Function] Found ${activeEvents.length} active games`);

        // 2. Fetch player props for each game
        const allOdds = [];
        const markets = 'player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_turnovers,player_points_rebounds,player_points_assists,player_rebounds_assists,player_points_rebounds_assists';

        for (const event of activeEvents) {
            const propsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?regions=us&markets=${markets}&oddsFormat=american&apiKey=${MARKET_API_KEY}`;

            try {
                const propsResp = await fetch(propsUrl);
                if (propsResp.ok) {
                    const propsData = await propsResp.json();
                    allOdds.push(propsData);
                }
            } catch (err) {
                console.error(`Error fetching props for ${event.id}:`, err.message);
            }

            // Rate limit delay
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`[Vercel Function] Successfully fetched odds for ${allOdds.length} games`);

        // 3. Return fresh odds data
        res.status(200).json({
            success: true,
            message: `Refreshed odds for ${allOdds.length} games`,
            gamesUpdated: allOdds.length,
            timestamp: new Date().toLocaleTimeString(),
            odds: allOdds
        });

    } catch (error) {
        console.error('[Vercel Function] Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh odds',
            details: error.message
        });
    }
};

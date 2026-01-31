require('dotenv').config();
const fetch = require('node-fetch');

(async () => {
    const MESSAGE_ID = process.argv[2];
    if (!MESSAGE_ID) {
        console.error('Usage: node check_telnyx_status.js <MESSAGE_ID>');
        process.exit(1);
    }

    console.log(`🔎 Checking Status for ID: ${MESSAGE_ID}...`);

    try {
        const response = await fetch(`https://api.telnyx.com/v2/messages/${MESSAGE_ID}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`
            }
        });

        const data = await response.json();

        if (response.ok) {
            console.log('--- FULL RESPONSE ---');
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.error('❌ API Error:', JSON.stringify(data, null, 2));
        }

    } catch (err) {
        console.error('❌ Network Failed:', err.message);
    }
})();

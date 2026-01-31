require('dotenv').config();
const fetch = require('node-fetch');

(async () => {
    console.log('📡 Testing Telnyx SMS via Direct API...');

    // Check key
    const API_KEY = process.env.TELNYX_API_KEY;
    if (!API_KEY) {
        console.error('❌ Missing TELNYX_API_KEY in .env');
        process.exit(1);
    }

    const FROM_NUMBER = '+13238801102';
    const TO_NUMBER = '+13109878715';

    try {
        const response = await fetch('https://api.telnyx.com/v2/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                from: FROM_NUMBER,
                to: TO_NUMBER,
                text: "Prophet Bot Manual Test: All Systems Go! 🚀 (4:12 PM)"
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Message queued successfully!');
            console.log('ID:', data.data ? data.data.id : data);
        } else {
            console.error('❌ Telnyx API Failed:', JSON.stringify(data, null, 2));
        }

    } catch (err) {
        console.error('❌ Network Failed:', err.message);
    }
})();

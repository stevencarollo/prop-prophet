const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
require('dotenv').config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SMS_SUBSCRIBERS_FILE = path.join(__dirname, '../history/sms_subscribers.json');

(async () => {
    try {
        console.log('🧪 Starting Resend SMS Test...');

        if (!RESEND_API_KEY) {
            throw new Error("Missing RESEND_API_KEY in .env");
        }
        console.log(`🔑 Key found: ${RESEND_API_KEY.substring(0, 5)}...`);

        let recipients = [];
        if (fs.existsSync(SMS_SUBSCRIBERS_FILE)) {
            recipients = JSON.parse(fs.readFileSync(SMS_SUBSCRIBERS_FILE, 'utf8'));
        } else {
            throw new Error("SMS Subscribers file not found!");
        }

        console.log(`📋 Found ${recipients.length} total entries.`);

        // Filter for valid emails only (Resend rejects raw numbers)
        recipients = recipients.filter(r => r.includes('@'));

        console.log(`📧 Sending to ${recipients.length} valid gateways:`, recipients);

        const resend = new Resend(RESEND_API_KEY);

        const body = "This is a TEST message from Prop Prophet (via Resend).\nSystem is ONLINE. 🟢\nTime: " + new Date().toLocaleTimeString();

        console.log('🚀 Sending test message...');

        // Note: Free tier restricted to sending to your own email unless domain verifies.
        // Assuming user will deliver to themselves first to test.
        // Sending to "onboarding@resend.dev" is FROM address.

        const data = await resend.emails.send({
            from: 'Prophet Bot <onboarding@resend.dev>',
            to: recipients,
            subject: "Prophet System Test (Resend)",
            text: body
        });

        if (data.error) {
            console.error('❌ Resend Error:', data.error);
        } else {
            console.log('✅ Message sent! ID:', data.data.id);
        }

    } catch (err) {
        console.error('❌ Error:', err);
    }
})();

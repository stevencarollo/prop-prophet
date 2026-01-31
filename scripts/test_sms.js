const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const SMS_SUBSCRIBERS_FILE = path.join(__dirname, '../history/sms_subscribers.json');

(async () => {
    try {
        console.log('🧪 Starting SMS Test...');

        if (!EMAIL_USER || !EMAIL_PASS) {
            throw new Error("Missing EMAIL_USER or EMAIL_PASS in .env");
        }
        console.log(`📧 using email: ${EMAIL_USER}`);

        let recipients = [];
        if (fs.existsSync(SMS_SUBSCRIBERS_FILE)) {
            recipients = JSON.parse(fs.readFileSync(SMS_SUBSCRIBERS_FILE, 'utf8'));
        } else {
            throw new Error("SMS Subscribers file not found!");
        }

        console.log(`📋 Found ${recipients.length} recipients:`, recipients);

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        const body = "This is a TEST message from Prop Prophet.\nIf you received this, the SMS system is ONLINE. 🟢\nTime: " + new Date().toLocaleTimeString();

        console.log('🚀 Sending test message...');
        let info = await transporter.sendMail({
            from: `"Prophet Bot" <${EMAIL_USER}>`,
            to: recipients.join(','),
            subject: "Prophet System Test",
            text: body
        });

        console.log('✅ Message sent: %s', info.messageId);

    } catch (err) {
        console.error('❌ Error:', err);
    }
})();

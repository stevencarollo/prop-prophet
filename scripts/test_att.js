const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

(async () => {
    try {
        console.log('🧪 Testing AT&T MMS Fix...');
        console.log('🧪 Testing Verizon SMS Fix...');

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        // Targeted test to the Verizon MMS Gateway
        const target = "3109878715@vzwpix.com";

        const body = "Prophet Bot Test: Verizon MMS (vzwpix) works! 🟢";

        console.log(`🚀 Sending test to ${target}...`);
        let info = await transporter.sendMail({
            from: `"Prophet Bot" <${EMAIL_USER}>`,
            to: target,
            subject: "", // MMS often works better with empty subject or short one
            text: body
        });

        console.log('✅ Message sent: %s', info.messageId);

    } catch (err) {
        console.error('❌ Error:', err);
    }
})();

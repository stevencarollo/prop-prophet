const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

// CONFIG
const GITHUB_REPO = 'stevencarollo/prop-prophet';
const FILE_PATH = 'history/sms_subscribers.json'; // Distinct file for SMS list
const BRANCH = 'main';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { email } = req.body;
    // For SMS Gateway, email is "number@carrier.com"
    if (!email || !email.includes('@')) {
        return res.status(400).json({ message: 'Invalid phone gateway address' });
    }

    const token = process.env.GH_PAT;
    if (!token) {
        return res.status(500).json({ message: 'Server Config Error: Missing GitHub Token' });
    }

    try {
        // 1. Get Current File
        const fileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
        const getResp = await fetch(fileUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        // Handle File Not Found (Create new if missing)
        let subscribers = [];
        let sha = null;

        if (getResp.ok) {
            const fileData = await getResp.json();
            const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
            sha = fileData.sha;
            try {
                subscribers = JSON.parse(content);
            } catch (e) {
                console.error('JSON Parse Error', e);
            }
        } else if (getResp.status !== 404) {
            const err = await getResp.text();
            throw new Error(`GitHub Get Failed: ${err}`);
        }

        // 4. Send Welcome SMS (Helper)
        async function sendWelcome(target) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
            });
            try {
                await transporter.sendMail({
                    from: `"Prophet Bot" <${process.env.EMAIL_USER}>`,
                    to: target,
                    subject: "",
                    text: "Psssst Hey. Its me the Prophet. Welcome to Prophet Lock Text Line. If i see something worth your time, I'll be sure to send it over. Please merk responsibly"
                });
                console.log('✅ Welcome SMS sent to:', target);
                return { sent: true };
            } catch (err) {
                console.error('⚠️ Welcome SMS failed:', err.message);
                return { sent: false, error: err.message };
            }
        }

        // 2. Add Subscriber
        if (subscribers.includes(email)) {
            // ALREADY SUBSCRIBED? Send Welcome anyway (User requested to duplicate action to test)
            const result = await sendWelcome(email);
            const msg = result.sent ? 'Already subscribed (Welcome resent!)' : `Already subscribed (But SMS Failed: ${result.error})`;
            return res.status(200).json({ message: msg });
        }

        // NEW SUBSCRIBER
        subscribers.push(email);

        // 3. Update File
        const newContent = Buffer.from(JSON.stringify(subscribers, null, 2)).toString('base64');
        const putResp = await fetch(fileUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: `📱 SMS Subscribe: ${email}`,
                content: newContent,
                sha: sha, // If null, creates new file
                branch: BRANCH
            })
        });

        if (!putResp.ok) {
            const putErr = await putResp.text();
            throw new Error(`GitHub Put Failed: ${putErr}`);
        }

        // Send Welcome to New User
        const result = await sendWelcome(email);
        const msg = result.sent ? 'Success' : `Success (But SMS Failed: ${result.error})`;
        return res.status(200).json({ message: msg });

    } catch (error) {
        console.error('Subscribe SMS Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

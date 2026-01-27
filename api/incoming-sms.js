const fetch = require('node-fetch');

// CONFIG
const GITHUB_REPO = 'stevencarollo/prop-prophet';
const FILE_PATH = 'history/sms_subscribers.json';
const BRANCH = 'main';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Twilio sends data in body (x-www-form-urlencoded)
    // Vercel parses this automatically.
    const messageBody = (req.body.Body || '').trim().toUpperCase();
    const fromNumber = req.body.From;

    console.log(`📩 Incoming SMS from ${fromNumber}: ${messageBody}`);

    // 1. Validate Intent
    if (messageBody !== 'PROPHET') {
        // XML Response (TwiML) - Ignore or reply with help
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send(`
            <Response>
                <Message>Reply PROPHET to subscribe to lock alerts.</Message>
            </Response>
        `);
    }

    // 2. Add Subscriber via GitHub API
    const token = process.env.GH_PAT;
    if (!token) {
        console.error('❌ Missing GH_PAT');
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send('<Response><Message>System Config Error. Try again later.</Message></Response>');
    }

    try {
        // A. Get Current List
        const fileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
        const getResp = await fetch(fileUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!getResp.ok) throw new Error('GitHub Fetch Failed');

        const fileData = await getResp.json();
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        let subscribers = [];
        try { subscribers = JSON.parse(content); } catch (e) { }

        // B. Add Number (if new)
        if (!subscribers.includes(fromNumber)) {
            subscribers.push(fromNumber);

            // C. Save Updates
            const newContent = Buffer.from(JSON.stringify(subscribers, null, 2)).toString('base64');
            await fetch(fileUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `📱 SMS Subscribe: ${fromNumber}`,
                    content: newContent,
                    sha: fileData.sha,
                    branch: BRANCH
                })
            });
            console.log(`✅ Subscribed ${fromNumber}`);
        } else {
            console.log(`⚠️ Already subscribed: ${fromNumber}`);
        }

        // 3. Success Response (TwiML)
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send(`
            <Response>
                <Message>🔒 You are now subscribed to Prophet Locks! You will receive a text whenever a Lock is detected. Reply STOP to unsubscribe.</Message>
            </Response>
        `);

    } catch (error) {
        console.error('❌ SMS Subscribe Error:', error);
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send('<Response><Message>Service Error. Please try again.</Message></Response>');
    }
};

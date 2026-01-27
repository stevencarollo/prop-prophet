const fetch = require('node-fetch');

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

        // 2. Add Subscriber
        if (subscribers.includes(email)) {
            return res.status(200).json({ message: 'Already subscribed' });
        }
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

        return res.status(200).json({ message: 'Success' });

    } catch (error) {
        console.error('Subscribe SMS Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

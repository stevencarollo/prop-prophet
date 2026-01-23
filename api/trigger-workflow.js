// Vercel Serverless Function: Trigger Full Prophet Workflow
// This function calls the GitHub API to trigger the Prophet Cloud Automation workflow

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

    if (!GITHUB_TOKEN) {
        console.error('GITHUB_TOKEN environment variable not set');
        return res.status(500).json({
            error: 'Server configuration error',
            message: 'GitHub token not configured. Please add GITHUB_TOKEN to Vercel environment variables.'
        });
    }

    try {
        // GitHub API endpoint to trigger workflow dispatch
        const owner = 'stevencarollo';
        const repo = 'prop-prophet';
        const workflow_id = 'daily.yml';

        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ref: 'main'  // Branch to run the workflow on
                })
            }
        );

        if (response.status === 204) {
            // Success - workflow triggered
            console.log('✅ Workflow triggered successfully');
            return res.status(200).json({
                success: true,
                message: 'Full Prophet workflow triggered! Please wait 2-3 minutes for fresh picks.',
                estimatedTime: '2-3 minutes'
            });
        } else {
            const errorData = await response.text();
            console.error('GitHub API error:', response.status, errorData);
            return res.status(response.status).json({
                error: 'Failed to trigger workflow',
                details: errorData
            });
        }
    } catch (error) {
        console.error('Error triggering workflow:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
};

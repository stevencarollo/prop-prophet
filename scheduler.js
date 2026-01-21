const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('⏰ Prophet Scheduler Started');
console.log('📅 Schedule: Morning Recon (11am) + Dynamic Lock Run (-20m to Tip)');

// Store the scheduled lock job to prevent duplicates if manual update runs
let lockJobTimeout = null;

// 1. Morning Recon (11:00 AM) - Get schedule and set the Lock Timer
cron.schedule('0 11 * * *', () => {
    console.log('🌅 Morning Recon Triggered (11:00 AM)');
    runUpdate('Morning Recon');
});

// 2. Crunch Time Refresh (Every 30m, 3pm-8pm) - Just to keep data fresh, but HISTORY LOCKING depends on the exact time
cron.schedule('0,30 15-20 * * *', () => runUpdate("Crunch Time"));

function runUpdate(label) {
    console.log(`[${new Date().toLocaleTimeString()}] 🚀 Triggering Update (${label})...`);
    // Note: User's workflow is explicitly 'daily_workflow.js' now, not 'download_bbm.js'
    const scriptPath = path.join(__dirname, 'scripts', 'daily_workflow.js');
    const nodeExe = process.execPath;

    exec(`"${nodeExe}" "${scriptPath}"`, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Update Failed: ${error.message}`);
            return;
        }
        if (stderr) console.error(`⚠️ Log: ${stderr}`);
        console.log(stdout);
        console.log(`[${new Date().toLocaleTimeString()}] ✅ ${label} Complete.`);

        // AUTO-PUBLISH to Netlify
        uploadResults(() => {
            // AFTER UPLOAD: Schedule the "Lock Run"
            scheduleLockRun();
        });
    });
}

function uploadResults(callback) {
    console.log('☁️ Uploading results to Cloud...');
    const cmd = `git add latest_picks.js history/prophet_history.json && git commit -m "🤖 Auto-Bot: New Picks & History" && git push origin main`;

    exec(cmd, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Upload Failed: ${error.message}`);
        } else {
            console.log(`✅ Cloud Sync Complete.`);
        }
        if (callback) callback();
    });
}

function scheduleLockRun() {
    try {
        const picksFile = path.join(__dirname, 'latest_picks.js');
        if (!fs.existsSync(picksFile)) return;

        // Read the file context to find the JSON
        // The file is: window.LATEST_PICKS = [...];
        const content = fs.readFileSync(picksFile, 'utf8');
        const jsonMatch = content.match(/window\.LATEST_PICKS\s*=\s*(\[[\s\S]*?\]);/);

        if (!jsonMatch) return;

        const picks = JSON.parse(jsonMatch[1]);
        if (picks.length === 0) return;

        // Find Earliest Start Time
        const earliest = picks.reduce((min, p) => {
            if (!p.startTime) return min;
            const t = new Date(p.startTime).getTime();
            return (t > 0 && t < min) ? t : min;
        }, Infinity);

        if (earliest === Infinity) {
            console.log('🤔 No start times found. Cannot schedule lock.');
            return;
        }

        const now = Date.now();
        const lockTime = earliest - (20 * 60 * 1000); // 20 minutes before
        const delay = lockTime - now;

        // Verify it's in the future and not TOO far (e.g. > 24h)
        if (delay > 0 && delay < 86400000) {
            console.log(`🔒 Lock Run Scheduled for: ${new Date(lockTime).toLocaleTimeString()} (Tip-off: ${new Date(earliest).toLocaleTimeString()})`);

            if (lockJobTimeout) clearTimeout(lockJobTimeout);

            lockJobTimeout = setTimeout(() => {
                console.log('🔒 LOCK RUN STARTING NOW!');
                runUpdate('OFFICIAL LOCK RUN');
            }, delay);
        } else {
            console.log(`⏳ Lock window already passed or invalid (${(delay / 60000).toFixed(1)} mins ago).`);
        }

    } catch (err) {
        console.error('⚠️ Failed to schedule lock run:', err);
    }
}

// Check schedule immediately on start
scheduleLockRun();

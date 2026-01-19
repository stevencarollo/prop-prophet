const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');

console.log('⏰ Prophet Scheduler Started');
console.log('📅 Schedule: Every Hour (10am - 8pm PT)');

// Schedule: At minute 0 past every hour from 10 through 20 (10am to 8pm)
// Cron syntax: "0 10-20 * * *"
// Adjust for timezone? Node-cron uses system time.
// Assuming User is in PT (metadata says so).

console.log('📅 Schedule: Morning (10am) + Crunch Time (Every 30m, 3pm-7:30pm PT)');

// 1. Morning Check (11:00 AM) - Get early lines/injuries
cron.schedule('0 11 * * *', () => {
    console.log('🌅 Morning Update Triggered (11:00 AM)');
    runUpdate();
});

// 2. Crunch Time (3:00 PM to 7:30 PM) - Covers most tip-offs
cron.schedule('0,30 15-19 * * *', () => runUpdate("Crunch Time"));

function runUpdate(label) {
    console.log(`[${new Date().toLocaleTimeString()}] 🚀 Triggering Update (${label})...`);
    const scriptPath = path.join(__dirname, 'scripts', 'download_bbm.js');
    const nodeExe = process.execPath;

    exec(`"${nodeExe}" "${scriptPath}"`, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Update Failed: ${error.message}`);
            return;
        }
        if (stderr) console.error(`⚠️ Log: ${stderr}`);
        console.log(stdout);
        console.log(`[${new Date().toLocaleTimeString()}] ✅ ${label} Complete.`);
    });
}

console.log('waiting for next tick...');

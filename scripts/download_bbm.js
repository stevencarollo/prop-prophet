const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Config
const TARGET_URL = 'https://basketballmonster.com/dailyprojections.aspx';
const LOGIN_URL = 'https://basketballmonster.com/login.aspx'; // Assumption, will verify flow
const USER = process.env.BBM_USER;
const PASS = process.env.BBM_PASS;
const DOWNLOAD_DIR = path.join(__dirname, '..'); // Root

(async () => {
    console.log('🤖 BBM Auto-Downloader Starting...');

    if (!USER || !PASS) {
        console.error('❌ Missing Credentials in .env');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: false, // Visible for debugging/user confidence
        defaultViewport: null,
        args: [
            '--start-maximized',
            '--disable-features=PasswordGeneration,PasswordManager,PasswordImport,PasswordBreachDetection,SafeBrowsingProtectionLevelEnhanced',
            '--disable-save-password-bubble',
            '--no-default-browser-check',
            '--disable-infobars',
            '--password-store=basic'
        ]
    });

    const page = await browser.newPage();

    // Setup Download Behavior
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_DIR,
    });

    try {
        // 1. Login
        console.log('🔑 Logging in...');
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

        // Use verified IDs
        await page.type('#UsernameTB', USER);
        await page.type('#PasswordTB', PASS);

        // Click Login
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#LoginButton')
        ]);
        console.log('✅ Logged In');

        // 2. Go to Projections
        console.log('📊 Navigating to Projections...');
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

        // 3. Click Export
        console.log('⬇️ locating Export button...');
        // Look for "Export to Excel"
        const [exportBtn] = await page.$$("xpath///input[@value='Export to Excel'] | //a[contains(text(), 'Export to Excel')] | //button[contains(text(), 'Export to Excel')]");

        if (exportBtn) {
            console.log('🖱️ Clicking Export...');
            // Capture filename before/after? 
            // Just wait for file to appear.
            await exportBtn.click();

            // Wait for download to finish writing
            console.log('⏳ Waiting 5s for download to complete...');
            await new Promise(r => setTimeout(r, 5000));

            // Find latest downloaded file
            const files = fs.readdirSync(DOWNLOAD_DIR)
                .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'))
                .map(f => ({ name: f, time: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtime.getTime() }))
                .sort((a, b) => b.time - a.time);

            if (files.length > 0) {
                const latest = files[0].name;
                const filePath = path.join(DOWNLOAD_DIR, latest);
                console.log(`✅ Found Latest File: ${latest}`);

                // 4. Auto-Upload to Local Dashboard
                console.log('🚀 Auto-Uploading to Prophet Server...');
                try {
                    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

                    // Check if Login is needed
                    const userField = await page.$('#username');
                    if (userField && await userField.boundingBox()) {
                        console.log('🔐 Logging into Dashboard...');
                        await page.type('#username', 'owner');
                        await page.type('#password', 'Reempicks1!');

                        // Find Login Button (onclick="login()")
                        const [lBtn] = await page.$$("xpath///button[contains(text(), 'Login')]");
                        if (lBtn) await lBtn.click();

                        await new Promise(r => setTimeout(r, 1000)); // Wait for UI transition
                    }

                    // Upload
                    console.log('📤 Sending file to engine...');
                    const inputUpload = await page.$('#bbm-file');
                    if (inputUpload) {
                        await inputUpload.uploadFile(filePath);

                        // Click the "Upload File" button
                        const [upBtn] = await page.$$("xpath///button[contains(text(), 'Upload File')]");
                        if (upBtn) {
                            await upBtn.click();
                            await new Promise(r => setTimeout(r, 2000));
                            console.log('✅ Data Uploaded.');

                            // A. Generate Picks
                            console.log('🧠 Generating Picks...');
                            const [genBtn] = await page.$$("xpath///button[contains(text(), 'Generate Picks')]");
                            if (genBtn) {
                                await genBtn.click();
                                await new Promise(r => setTimeout(r, 5000)); // Wait for API calls
                                console.log('✅ Picks Generated.');
                            } else {
                                console.error('❌ Could not find Generate button.');
                            }

                            // B. Publish to Netlify (Save file locally)
                            console.log('💾 Publishing to File...');
                            const [pubBtn] = await page.$$("xpath///button[contains(text(), 'Publish to Netlify')]");
                            if (pubBtn) {
                                await pubBtn.click();
                                await new Promise(r => setTimeout(r, 2000)); // Wait for save
                                console.log('✅ latest_picks.js Updated.');
                            } else {
                                console.error('❌ Could not find Publish button.');
                            }

                            console.log('✅ UPDATE COMPLETE. The server now has the fresh data.');

                            // 5. DEPLOY TO NETLIFY
                            console.log('🌍 Deploying to Global Network (Netlify)...');
                            await new Promise((resolve, reject) => {
                                // Run deploy in root dir (Using npx to ensure local cli is used)
                                exec('npx netlify deploy --prod --dir=.', { cwd: DOWNLOAD_DIR }, (err, stdout, stderr) => {
                                    if (err) {
                                        console.error('❌ Netlify Fail:', stderr || err.message);
                                        resolve();
                                    } else {
                                        console.log(stdout);
                                        console.log('🚀 LIVE GAME DATA PUBLISHED TO THE WORLD.');
                                        resolve();
                                    }
                                });
                            });
                        } else {
                            console.error('❌ Could not find Upload button on Dashboard.');
                        }
                    } else {
                        console.error('❌ Could not find File Input (#bbm-file) on Dashboard. Is the server running?');
                    }
                } catch (dashboardErr) {
                    console.error('❌ Failed to access Local Dashboard. Is the server running?', dashboardErr.message);
                }

            } else {
                console.error('❌ No Excel file found in folder.');
            }

        } else {
            console.error('❌ Could not find "Export to Excel" button.');
        }

    } catch (e) {
        console.error('❌ Automation Error:', e);
    } finally {
        console.log('👋 Closing Robot...');
        await browser.close();
    }
})();

const puppeteer = require('puppeteer');
const fs = require('fs');

const run = async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    // Login
    await page.goto('https://basketballmonster.com/login.aspx');
    await page.type('#UsernameTB', 'stevencarollo');
    await page.type('#PasswordTB', 'Hermosabeach1');
    await Promise.all([
        page.click('#LoginButton'),
        page.waitForNavigation()
    ]);

    // Go to Ease
    await page.goto('https://basketballmonster.com/easerankings.aspx');

    // Inspect Table
    const info = await page.evaluate(() => {
        const table = document.querySelector('table.datatable');
        if (!table) return "No Table Found";

        const headerRow = table.querySelector('thead tr');
        const headers = Array.from(headerRow.cells).map(c => c.innerText);

        const firstRow = table.querySelector('tbody tr');
        const firstRowData = Array.from(firstRow.cells).map(c => c.innerText);

        return { headers, firstRowData };
    });

    console.log("Headers:", info.headers);
    console.log("First Row:", info.firstRowData);

    await browser.close();
};

run();

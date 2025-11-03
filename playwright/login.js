"use strict";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const {
    POWERPLAY_APP_URL,
    PP_USERNAME,
    PP_PASSWORD,
    PP_LOGIN_USERNAME_SELECTOR,
    PP_LOGIN_PASSWORD_SELECTOR,
    PP_LOGIN_NEXT_SELECTOR,
    PP_LOGIN_SUBMIT_SELECTOR,
    COOKIE_PATH,
    DEALER_REGION,
} = process.env;

function ensureDir(dirPath) { try { fs.mkdirSync(dirPath, { recursive: true }); } catch {} }

(async () => {
    const region = DEALER_REGION || "Unknown Region";
    const appUrl = POWERPLAY_APP_URL || "https://powerplay.generac.com/app/";

    if (!COOKIE_PATH) { console.error("COOKIE_PATH env var is required"); process.exit(2); }
    if (!PP_USERNAME || !PP_PASSWORD) { console.error("PP_USERNAME and PP_PASSWORD env vars are required"); process.exit(3); }
    if (!PP_LOGIN_USERNAME_SELECTOR || !PP_LOGIN_PASSWORD_SELECTOR || !PP_LOGIN_SUBMIT_SELECTOR) {
        console.error("PP_LOGIN_* selector env vars are required (USERNAME, PASSWORD, SUBMIT; NEXT optional)");
        process.exit(4);
    }

    console.log(`[${region}] 🔐 Launching Chromium...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log(`[${region}] 🌐 Navigating to ${appUrl}`);
        await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

        await page.waitForSelector(PP_LOGIN_USERNAME_SELECTOR, { state: "visible", timeout: 45000 });
        console.log(`[${region}] ✏️  Filling username`);
        await page.fill(PP_LOGIN_USERNAME_SELECTOR, PP_USERNAME);

        if (PP_LOGIN_NEXT_SELECTOR) {
            await page.click(PP_LOGIN_NEXT_SELECTOR, { timeout: 30000 });
        }

        await page.waitForSelector(PP_LOGIN_PASSWORD_SELECTOR, { state: "visible", timeout: 45000 });
        console.log(`[${region}] 🔑 Filling password`);
        await page.fill(PP_LOGIN_PASSWORD_SELECTOR, PP_PASSWORD);

        await page.click(PP_LOGIN_SUBMIT_SELECTOR, { timeout: 30000 });

        try { await page.waitForURL("**/app/**", { timeout: 60000 }); }
        catch { await page.waitForLoadState("networkidle", { timeout: 60000 }); }
        console.log(`[${region}] ✅ Logged in successfully`);

        const cookies = await context.cookies();
        ensureDir(path.dirname(COOKIE_PATH));
        fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
        console.log(`[${region}] 🍪 Cookies saved to ${COOKIE_PATH}`);

        await browser.close();
        process.exit(0);
    } catch (err) {
        console.error(`[${region}] ❌ login.js failed:`, err && err.message ? err.message : err);
        try {
            ensureDir("/var/data");
            await page.screenshot({ path: `/var/data/login-failure-${Date.now()}.png` });
            console.log("💾 Screenshot saved for debugging");
        } catch {}
        await browser.close();
        process.exit(1);
    }
})();



"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

async function fillIfPresent(page, selector, value) {
    const el = await page.$(selector);
    if (el) {
        await el.fill("");
        await el.type(value, { delay: 15 });
        return true;
    }
    return false;
}

(async () => {
    const region = process.env.DEALER_REGION || "Unknown Region";
    const appUrl = process.env.POWERPLAY_APP_URL || "https://powerplay.generac.com/app/powerplay3/";
    const cookiePath = process.env.COOKIE_PATH;
    const username = process.env.PP_USERNAME;
    const password = process.env.PP_PASSWORD;
    const mfaCode = process.env.PP_MFA_CODE || ""; // Optional one-time code

    if (!cookiePath) {
        console.error("COOKIE_PATH env var is required");
        process.exit(2);
    }
    if (!username || !password) {
        console.error("PP_USERNAME and PP_PASSWORD env vars are required");
        process.exit(3);
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`[${region}] 🔐 Navigating to ${appUrl}`);
    await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Heuristics: detect login form
    const loginSelectors = [
        'input[type="email"]',
        'input[name="username"]',
        'input[autocomplete="username"]',
        'input[type="text"]',
    ];
    const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[autocomplete="current-password"]',
    ];

    // If already logged in, proceed to save cookies
    let needsLogin = false;
    try {
        await page.waitForSelector(`${loginSelectors.join(', ')}, ${passwordSelectors.join(', ')}`, { timeout: 5000 });
        needsLogin = true;
    } catch {
        needsLogin = false;
    }

    if (needsLogin) {
        console.log(`[${region}] ✏️  Filling credentials`);
        // Username
        for (const sel of loginSelectors) {
            if (await fillIfPresent(page, sel, username)) break;
        }
        // Password
        let pwFilled = false;
        for (const sel of passwordSelectors) {
            if (await fillIfPresent(page, sel, password)) { pwFilled = true; break; }
        }
        if (!pwFilled) {
            console.warn(`[${region}] Could not find password field immediately, trying again after small delay`);
            await page.waitForTimeout(500);
            for (const sel of passwordSelectors) {
                if (await fillIfPresent(page, sel, password)) { pwFilled = true; break; }
            }
        }

        // Submit
        const submitSelectors = [
            'button[type="submit"]',
            'button:has-text("Log in")',
            'button:has-text("Sign in")',
            'input[type="submit"]',
        ];
        let submitted = false;
        for (const sel of submitSelectors) {
            const btn = await page.$(sel);
            if (btn) { await btn.click(); submitted = true; break; }
        }
        if (!submitted) {
            // Fallback: press Enter in password field
            const pw = await page.$(passwordSelectors.join(", "));
            if (pw) { await pw.press("Enter"); submitted = true; }
        }

        // Optional MFA step
        if (mfaCode) {
            try {
                const mfaInput = await page.waitForSelector(
                    'input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"], input[type="tel"]',
                    { timeout: 10000 }
                );
                if (mfaInput) {
                    console.log(`[${region}] 🔢 Entering MFA code`);
                    await mfaInput.fill("");
                    await mfaInput.type(mfaCode, { delay: 30 });
                    // Try to submit
                    const mfaSubmit = await page.$('button[type="submit"], button:has-text("Verify"), button:has-text("Continue")');
                    if (mfaSubmit) await mfaSubmit.click();
                }
            } catch {}
        }

        // Wait for app load
        await page.waitForLoadState("networkidle", { timeout: 60000 });
        // small settle
        await page.waitForTimeout(1000);
    } else {
        console.log(`[${region}] ✅ Already logged in session detected`);
    }

    // Save cookies
    const cookies = await context.cookies();
    await ensureDir(cookiePath);
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    console.log(`[${region}] ✅ Cookies saved to ${cookiePath}`);

    await browser.close();
    process.exit(0);
})().catch(async (err) => {
    console.error("login.js error:", err && err.stack ? err.stack : err);
    process.exit(1);
});



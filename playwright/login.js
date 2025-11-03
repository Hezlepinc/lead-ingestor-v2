"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

async function fillIfPresent(scope, selector, value) {
    const el = await scope.$(selector);
    if (!el) return false;
    await el.fill("");
    await el.type(value, { delay: 15 });
    return true;
}

function findAuthFrame(page, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const tryFind = async () => {
            // Look for an Auth0 or login frame by URL hints
            const frames = page.frames();
            for (const f of frames) {
                const u = f.url() || "";
                if (/auth0|login|authorize|u\/login|identity|auth\//i.test(u)) {
                    return resolve(f);
                }
            }
            if (Date.now() - start > timeoutMs) return resolve(null);
            setTimeout(tryFind, 250);
        };
        tryFind();
    });
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
    // Allow redirects to auth provider
    try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}

    // Heuristics: detect login form
    const openLoginSelectors = [
        'button:has-text("Sign in")',
        'button:has-text("Log in")',
        'button:has-text("Continue")',
        'a:has-text("Sign in")',
        'a:has-text("Log in")',
        'a[href*="login" i]'
    ];
    // Try to reveal hidden forms
    for (const sel of openLoginSelectors) {
        const btn = await page.$(sel);
        if (btn) {
            try { await btn.click({ timeout: 2000 }); } catch {}
            try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}
            break;
        }
    }

    const loginSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[autocomplete="username"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="user" i]',
        'input[type="text"]',
        'input[id*="username" i]'
    ];
    const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[autocomplete="current-password"]',
        'input[placeholder*="password" i]',
        'input[id*="password" i]'
    ];

    // If already logged in, proceed to save cookies
    // Decide whether login is required and locate the scope (page or auth frame)
    let scope = page;
    let needsLogin = false;
    try {
        await page.waitForSelector(`${loginSelectors.join(', ')}, ${passwordSelectors.join(', ')}`, { timeout: 5000 });
        needsLogin = true;
    } catch {
        // Try an auth frame
        const authFrame = await findAuthFrame(page, 15000);
        if (authFrame) {
            scope = authFrame;
            try {
                await authFrame.waitForSelector(`${loginSelectors.join(', ')}, ${passwordSelectors.join(', ')}`, { timeout: 5000 });
                needsLogin = true;
            } catch {}
        }
    }

    if (needsLogin) {
        console.log(`[${region}] ✏️  Filling credentials`);
        // Username
        let userFilled = false;
        for (const sel of loginSelectors) {
            if (await fillIfPresent(scope, sel, username)) { userFilled = true; break; }
        }
        if (!userFilled) {
            // Try label-based locator
            const labelUser = await scope.getByLabel ? scope.getByLabel(/email|user name|username/i).first() : null;
            if (labelUser) { await labelUser.fill(username); userFilled = true; }
        }
        // Password
        let pwFilled = false;
        for (const sel of passwordSelectors) {
            if (await fillIfPresent(scope, sel, password)) { pwFilled = true; break; }
        }
        if (!pwFilled && scope.getByLabel) {
            const labelPw = scope.getByLabel(/password/i).first();
            try { await labelPw.fill(password); pwFilled = true; } catch {}
        }

        // Submit
        const submitSelectors = [
            'button[type="submit"]',
            'button:has-text("Log in")',
            'button:has-text("Sign in")',
            'button:has-text("Continue")',
            'input[type="submit"]',
        ];
        let submitted = false;
        for (const sel of submitSelectors) {
            const btn = await scope.$(sel);
            if (btn) { await btn.click(); submitted = true; break; }
        }
        if (!submitted) {
            // Fallback: press Enter in password field
            const pw = await scope.$(passwordSelectors.join(", "));
            if (pw) { await pw.press("Enter"); submitted = true; }
        }

        // Optional MFA step
        if (mfaCode) {
            try {
                const mfaInput = await scope.waitForSelector(
                    'input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"], input[type="tel"]',
                    { timeout: 10000 }
                );
                if (mfaInput) {
                    console.log(`[${region}] 🔢 Entering MFA code`);
                    await mfaInput.fill("");
                    await mfaInput.type(mfaCode, { delay: 30 });
                    // Try to submit
                    const mfaSubmit = await scope.$('button[type="submit"], button:has-text("Verify"), button:has-text("Continue")');
                    if (mfaSubmit) await mfaSubmit.click();
                }
            } catch {}
        }

        // Wait for app load
        try { await page.waitForLoadState("networkidle", { timeout: 60000 }); } catch {}
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



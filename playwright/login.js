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

function findAuthFrame(page, timeoutMs = 20000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const tryFind = async () => {
            // Look for an Auth0 or login frame by URL hints
            const frames = page.frames();
            for (const f of frames) {
                const u = f.url() || "";
                if (/auth0|login|authorize|u\/login|identity|auth\//i.test(u) || /microsoftonline|live\.com|okta|pingidentity|onelogin|adfs|saml|oauth2/i.test(u)) {
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
    const appUrl = process.env.POWERPLAY_APP_URL || "https://powerplay.generac.com/app/";
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

    // Optional explicit selectors via env (SSO-specific)
    const OV_USER = process.env.PP_LOGIN_USERNAME_SELECTOR || "";
    const OV_NEXT = process.env.PP_LOGIN_NEXT_SELECTOR || "";
    const OV_PASS = process.env.PP_LOGIN_PASSWORD_SELECTOR || "";
    const OV_SUBMIT = process.env.PP_LOGIN_SUBMIT_SELECTOR || "";

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
        // Username (env override first)
        let userFilled = false;
        if (OV_USER) {
            try {
                const el = await scope.waitForSelector(OV_USER, { timeout: 5000 });
                if (el) { await el.fill(""); await el.type(username, { delay: 15 }); userFilled = true; }
            } catch {}
        }
        for (const sel of loginSelectors) {
            if (await fillIfPresent(scope, sel, username)) { userFilled = true; break; }
        }
        if (!userFilled) {
            // Try label-based locator
            const labelUser = await scope.getByLabel ? scope.getByLabel(/email|user name|username/i).first() : null;
            if (labelUser) { await labelUser.fill(username); userFilled = true; }
        }
        // Some SSO flows require a Next/Continue before password appears
        if (OV_NEXT) {
            try { const btn = await scope.$(OV_NEXT); if (btn) await btn.click(); } catch {}
        } else {
            const nextCandidates = [
                'input[type="submit"][value="Next" i]',
                'button:has-text("Next")',
                '#idSIButton9'
            ];
            for (const sel of nextCandidates) {
                const btn = await scope.$(sel);
                if (btn) { try { await btn.click(); } catch {} break; }
            }
        }
        try { await scope.waitForTimeout(800); } catch {}
        // Password (env override first)
        let pwFilled = false;
        if (OV_PASS) {
            try {
                const el = await scope.waitForSelector(OV_PASS, { timeout: 5000 });
                if (el) { await el.fill(""); await el.type(password, { delay: 20 }); pwFilled = true; }
            } catch {}
        }
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
        if (OV_SUBMIT) {
            try { const el = await scope.$(OV_SUBMIT); if (el) { await el.click(); submitted = true; } } catch {}
        }
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



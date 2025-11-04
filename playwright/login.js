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

function parseSelectors(selectorCsv) {
    return String(selectorCsv || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

async function clickAny(page, selectors, options = {}) {
    for (const sel of selectors) {
        const loc = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
            const el = loc.nth(i);
            try {
                const visible = await el.isVisible().catch(() => false);
                if (!visible) continue;
                const ariaHidden = await el.getAttribute("aria-hidden").catch(() => null);
                const className = await el.getAttribute("class").catch(() => "");
                if (ariaHidden === "true") continue;
                if (className && /(hidden|ulp-hidden-form-submit-button)/i.test(className)) continue;
                await el.click({ timeout: 3000, ...options });
                return true;
            } catch {}
        }
        // Fallback: try force-click first element if none clicked
        try { await loc.first().click({ force: true, timeout: 2000, ...options }); return true; } catch {}
    }
    return false;
}

async function safeFill(page, selectors, value) {
    // 1) Try normal fill on first visible selector
    for (const sel of selectors) {
        const loc = page.locator(sel);
        try {
            await loc.first().waitFor({ state: "visible", timeout: 2000 });
            await loc.first().fill(value, { timeout: 2000 });
            return true;
        } catch {}
    }
    // 2) Force-click then type
    for (const sel of selectors) {
        const loc = page.locator(sel);
        try {
            await loc.first().waitFor({ state: "attached", timeout: 2000 });
            await loc.first().click({ force: true, timeout: 2000 });
            await page.keyboard.type(value, { delay: 20 });
            return true;
        } catch {}
    }
    // 3) Set value via script
    for (const sel of selectors) {
        try {
            const ok = await page.evaluate(({ sel, value }) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                el.focus();
                el.value = value;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
            }, { sel, value });
            if (ok) return true;
        } catch {}
    }
    return false;
}

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

        const userSelectors = parseSelectors(PP_LOGIN_USERNAME_SELECTOR);
        const passSelectors = parseSelectors(PP_LOGIN_PASSWORD_SELECTOR);
        const nextSelectors = parseSelectors(PP_LOGIN_NEXT_SELECTOR);
        const submitSelectors = parseSelectors(PP_LOGIN_SUBMIT_SELECTOR);

        console.log(`[${region}] ✏️  Filling username`);
        const userOk = await safeFill(page, userSelectors, PP_USERNAME);
        if (!userOk) throw new Error(`Could not fill username using selectors: ${userSelectors.join(" | ")}`);
        // Move focus off the field so overlays don’t trap clicks
        try { await page.keyboard.press("Tab"); } catch {}

        if (nextSelectors.length) {
            await clickAny(page, nextSelectors, { timeout: 5000 });
        }

        console.log(`[${region}] 🔑 Filling password`);
        const passOk = await safeFill(page, passSelectors, PP_PASSWORD);
        if (!passOk) throw new Error(`Could not fill password using selectors: ${passSelectors.join(" | ")}`);

        const submitted = await clickAny(page, submitSelectors, { timeout: 5000 });
        if (!submitted) {
            // Fallback: press Enter inside password field
            try { await page.keyboard.press("Enter"); } catch {}
        }

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



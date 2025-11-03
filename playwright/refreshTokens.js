"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function readJsonIfExists(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
        return null;
    }
}

function looksLikeJwt(str) {
    if (typeof str !== "string") return false;
    const parts = str.split(".");
    if (parts.length !== 3) return false;
    try {
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        return typeof payload === "object" && typeof payload.exp === "number";
    } catch {
        return false;
    }
}

async function extractBestJwt(page) {
    const results = await page.evaluate(() => {
        const out = [];
        const scanStore = (store) => {
            for (let i = 0; i < store.length; i++) {
                const key = store.key(i);
                const val = store.getItem(key);
                out.push({ source: "storage", key, val });
                // Try to parse JSON-ish values
                try {
                    const obj = JSON.parse(val);
                    if (obj && typeof obj === "object") {
                        for (const k of Object.keys(obj)) {
                            const v = obj[k];
                            if (typeof v === "string") {
                                out.push({ source: "json", key: `${key}.${k}`, val: v });
                            }
                        }
                    }
                } catch {}
            }
        };
        scanStore(window.localStorage);
        scanStore(window.sessionStorage);
        // Also push cookies string
        out.push({ source: "cookie", key: "document.cookie", val: document.cookie || "" });
        return out;
    });

    const candidates = [];

    for (const item of results) {
        if (!item.val) continue;
        // Cookie may contain multiple k=v; scan tokens in it
        const possible = String(item.val).split(/[;\s]+/);
        for (const s of possible) {
            const maybe = s.includes("=") ? s.split("=").slice(1).join("=") : s;
            const trimmed = maybe.trim();
            if (looksLikeJwt(trimmed)) {
                try {
                    const payload = JSON.parse(Buffer.from(trimmed.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
                    candidates.push({ token: trimmed, exp: payload.exp });
                } catch {}
            }
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.exp - a.exp);
    return candidates[0].token;
}

async function validateToken(page, apiRoot, token) {
    try {
        const res = await page.evaluate(async ({ apiRoot, token }) => {
            const r = await fetch(`${apiRoot}/UserProfile`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: "include",
            });
            return { ok: r.ok, status: r.status };
        }, { apiRoot, token });
        return res.ok;
    } catch {
        return false;
    }
}

(async () => {
    const region = process.env.DEALER_REGION || "Unknown Region";
    const tokenPath = process.env.TOKEN_PATH;
    const cookiePath = process.env.COOKIE_PATH;
    const appUrl = process.env.POWERPLAY_APP_URL || "https://powerplay.generac.com/app/powerplay3/";
    const apiRoot = process.env.POWERPLAY_API_ROOT || "https://powerplay.generac.com/app/powerplay3-server/api";

    if (!tokenPath) {
        console.error("TOKEN_PATH env var is required");
        process.exit(2);
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // Load cookies if present
    if (cookiePath && fs.existsSync(cookiePath)) {
        const cookieData = readJsonIfExists(cookiePath);
        if (cookieData) {
            if (Array.isArray(cookieData)) {
                await context.addCookies(cookieData);
            } else if (Array.isArray(cookieData.cookies)) {
                await context.addCookies(cookieData.cookies);
            }
        }
    }

    const page = await context.newPage();
    await page.goto(appUrl, { waitUntil: "networkidle", timeout: 60000 });

    // Attempt extraction and validation
    const token = await extractBestJwt(page);
    if (!token) {
        console.error(`[${region}] Failed to locate id_token on page`);
        await browser.close();
        process.exit(3);
    }

    const valid = await validateToken(page, apiRoot, token);
    if (!valid) {
        console.error(`[${region}] Extracted token failed validation against UserProfile`);
        await browser.close();
        process.exit(4);
    }

    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `${token}\n`, "utf8");

    // Print expiry for logs
    let expStr = "unknown";
    try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        expStr = new Date(payload.exp * 1000).toISOString();
    } catch {}
    console.log(`[${region}] ✅ Refreshed id_token — expires ${expStr}`);

    await browser.close();
    process.exit(0);
})().catch(async (err) => {
    console.error("Playwright refreshTokens error:", err && err.stack ? err.stack : err);
    process.exit(1);
});



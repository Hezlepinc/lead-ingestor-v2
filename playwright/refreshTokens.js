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
    // Capture oauth/token network responses (Auth0)
    let captured = null;
    const onResponse = async (response) => {
        try {
            const url = response.url();
            if (!/oauth\/token|authorize/i.test(url)) return;
            const ct = (response.headers()["content-type"] || "").toLowerCase();
            if (!ct.includes("application/json")) return;
            const body = await response.json().catch(() => null);
            if (body && typeof body === "object") {
                const maybe = body.id_token || body.idToken || body.access_token || body.accessToken;
                if (typeof maybe === "string" && looksLikeJwt(maybe)) captured = maybe;
            }
        } catch {}
    };
    page.on("response", onResponse);

    // Scan storages, cookies, and inline scripts
    const texts = await page.evaluate(() => {
        const out = [];
        const push = (v) => { if (typeof v === "string") out.push(v); };
        const scanObj = (o) => {
            if (!o || typeof o !== "object") return;
            for (const k of Object.keys(o)) {
                const v = o[k];
                if (typeof v === "string") out.push(v); else if (v && typeof v === "object") try { scanObj(v); } catch {}
            }
        };
        const scanStore = (s) => {
            for (let i = 0; i < s.length; i++) {
                const key = s.key(i);
                const v = s.getItem(key);
                push(v);
                try { scanObj(JSON.parse(v)); } catch {}
            }
        };
        try { scanStore(localStorage); } catch {}
        try { scanStore(sessionStorage); } catch {}
        try { out.push(document.cookie || ""); } catch {}
        try { document.querySelectorAll("script").forEach(s => s.textContent && out.push(s.textContent)); } catch {}
        return out;
    });

    const candidates = [];
    const pluck = (str) => {
        const parts = String(str || "").split(/[;\s"'`,]+/);
        for (const p of parts) {
            const t = p.trim();
            if (looksLikeJwt(t)) {
                try {
                    const payload = JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
                    candidates.push({ token: t, exp: payload.exp || 0 });
                } catch {}
            }
        }
    };
    texts.forEach(pluck);

    // Small wait to allow network capture
    if (!candidates.length && !captured) {
        for (let i = 0; i < 10 && !captured; i++) await new Promise(r => setTimeout(r, 300));
        if (captured) return captured;
    }
    if (!candidates.length) return null;
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
    const appUrl = process.env.POWERPLAY_APP_URL || "https://powerplay.generac.com/app/";
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



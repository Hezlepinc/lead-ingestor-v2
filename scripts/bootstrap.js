"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

function exists(p) {
    try { return fs.existsSync(p); } catch { return false; }
}

function runNode(scriptPath, extraEnv = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath], {
            stdio: "inherit",
            env: { ...process.env, ...extraEnv },
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) return resolve();
            reject(new Error(`${scriptPath} exited with ${code}`));
        });
    });
}

async function ensureCookiesAndToken() {
    const region = process.env.DEALER_REGION || "Unknown Region";
    const cookiePath = process.env.COOKIE_PATH;
    const tokenPath = process.env.TOKEN_PATH;

    if (!cookiePath || !tokenPath) {
        console.error("Missing COOKIE_PATH or TOKEN_PATH env vars");
        process.exit(2);
    }

    if (!exists(cookiePath)) {
        console.log(`[${region}] 🍪 Cookies not found — running login.js`);
        await runNode("playwright/login.js");
    }

    if (!exists(tokenPath)) {
        console.log(`[${region}] 🔑 Token file not found — running refreshTokens.js`);
        await runNode("playwright/refreshTokens.js");
    }
}

async function main() {
    await ensureCookiesAndToken();
    const app = spawn(process.execPath, ["src/index.js"], {
        stdio: "inherit",
        env: { ...process.env },
    });
    app.on("close", (code) => process.exit(code || 0));
}

main().catch((err) => {
    console.error("bootstrap error:", err && err.stack ? err.stack : err);
    process.exit(1);
});



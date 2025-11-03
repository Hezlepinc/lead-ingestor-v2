"use strict";

const { spawn } = require("child_process");
const fs = require("fs");

function runLoginOnce({ regionName, cookiePath }) {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            DEALER_REGION: regionName,
            COOKIE_PATH: cookiePath,
        };
        const child = spawn(process.execPath, ["playwright/login.js"], {
            stdio: "inherit",
            env,
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) return resolve();
            reject(new Error(`login.js exited with ${code}`));
        });
    });
}

function startCookieRenewal(options) {
    const {
        regionName,
        cookiePath,
        intervalMinutes = 24 * 60,
        jitterMinutes = 5,
        runOnStartIfMissing = true,
    } = options;

    async function scheduleNext() {
        const jitter = Math.floor(Math.random() * Math.max(0, jitterMinutes)) * 60 * 1000;
        const delay = intervalMinutes * 60 * 1000 + jitter;
        setTimeout(async () => {
            try {
                console.log(`[${regionName}] 🔁 Daily cookie renewal starting...`);
                await runLoginOnce({ regionName, cookiePath });
                console.log(`[${regionName}] ✅ Cookies renewed`);
            } catch (err) {
                console.error(`[${regionName}] ❌ Cookie renewal failed:`, err && err.message ? err.message : err);
            } finally {
                scheduleNext();
            }
        }, delay);
        const nextAt = new Date(Date.now() + delay);
        console.log(`[${regionName}] ⏰ Next cookie renewal scheduled at ${nextAt.toISOString()}`);
    }

    if (runOnStartIfMissing) {
        try {
            if (!fs.existsSync(cookiePath)) {
                console.log(`[${regionName}] 🍪 No cookie file found, running initial login`);
                runLoginOnce({ regionName, cookiePath })
                    .then(() => console.log(`[${regionName}] ✅ Initial cookies saved`))
                    .catch((e) => console.error(`[${regionName}] ❌ Initial login failed:`, e && e.message ? e.message : e));
            }
        } catch {}
    }

    scheduleNext();
}

module.exports = { startCookieRenewal };



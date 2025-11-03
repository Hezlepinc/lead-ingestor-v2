"use strict";

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const EventEmitter = require("events");

/**
 * TokenService maintains a region-scoped id_token in memory
 * and refreshes it just before expiry using a Playwright script.
 */
class TokenService extends EventEmitter {
    constructor(options) {
        super();
        this.regionName = options.regionName || process.env.DEALER_REGION || "Unknown Region";
        this.tokenFilePath = options.tokenFilePath || process.env.TOKEN_PATH;
        this.cookieFilePath = options.cookieFilePath || process.env.COOKIE_PATH;
        this.playwrightScriptPath = options.playwrightScriptPath || path.join(process.cwd(), "playwright", "refreshTokens.js");
        this.currentToken = null;
        this.expiryDate = null;
        this.lastRefreshedAt = null;
        this.refreshTimer = null;
        this.refreshInFlight = null;

        if (!this.tokenFilePath) {
            throw new Error("TOKEN_PATH is required to initialize TokenService");
        }

        this.loadFromDisk();
        this.scheduleRefresh();
    }

    loadFromDisk() {
        const contents = fs.readFileSync(this.tokenFilePath, "utf8").trim();
        const decoded = jwt.decode(contents);
        if (!decoded || !decoded.exp) {
            throw new Error(`Invalid token at ${this.tokenFilePath} — missing exp claim`);
        }
        this.currentToken = contents;
        this.expiryDate = new Date(decoded.exp * 1000);
        this.lastRefreshedAt = new Date();
        this.emit("tokenLoaded", { token: this.currentToken, expiresAt: this.expiryDate });
        console.log(`[${this.regionName}] 🔐 Token loaded — expires ${this.expiryDate.toISOString()}`);
    }

    getToken() {
        // Trigger background refresh if within 5 minutes of expiry
        const now = Date.now();
        const thresholdMs = 5 * 60 * 1000;
        if (this.expiryDate && now > (this.expiryDate.getTime() - thresholdMs)) {
            this.refresh().catch(() => {});
        }
        return this.currentToken;
    }

    getExpiry() {
        return this.expiryDate;
    }

    getLastRefreshedAt() {
        return this.lastRefreshedAt;
    }

    async refresh() {
        if (this.refreshInFlight) return this.refreshInFlight;
        console.log(`[${this.regionName}] 🔁 Token expiring soon — refreshing...`);
        this.refreshInFlight = new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                TOKEN_PATH: this.tokenFilePath,
                COOKIE_PATH: this.cookieFilePath || process.env.COOKIE_PATH || "",
                DEALER_REGION: this.regionName,
            };

            const child = spawn(process.execPath, [this.playwrightScriptPath], {
                stdio: "inherit",
                env,
            });

            child.on("error", (err) => {
                this.refreshInFlight = null;
                reject(err);
            });

            child.on("close", (code) => {
                this.refreshInFlight = null;
                if (code !== 0) {
                    return reject(new Error(`Playwright refresh exited with code ${code}`));
                }
                try {
                    this.loadFromDisk();
                    this.scheduleRefresh();
                    console.log(`[${this.regionName}] ✅ Token refreshed — expires ${this.expiryDate.toISOString()}`);
                    this.emit("tokenRefreshed", { token: this.currentToken, expiresAt: this.expiryDate });
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });

        return this.refreshInFlight;
    }

    scheduleRefresh() {
        if (!this.expiryDate) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        const fiveMinutesMs = 5 * 60 * 1000;
        const delay = Math.max(0, this.expiryDate.getTime() - Date.now() - fiveMinutesMs);
        this.refreshTimer = setTimeout(() => {
            this.refresh().catch((err) => {
                console.error(`[${this.regionName}] ❌ Token refresh failed:`, err.message);
                // Fallback: try again in 60s
                this.refreshTimer = setTimeout(() => this.scheduleRefresh(), 60 * 1000);
            });
        }, delay);
        const nextAt = new Date(Date.now() + delay);
        console.log(`[${this.regionName}] ⏰ Next refresh scheduled at ${nextAt.toISOString()}`);
    }
}

module.exports = {
    TokenService,
};



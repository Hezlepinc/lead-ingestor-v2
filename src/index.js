"use strict";

// Polyfill WebSocket for @microsoft/signalr in Node
global.WebSocket = require("ws");

const { TokenService } = require("./auth/tokenService");
const { createLeadPoolConnection } = require("./hubClient");
const { claimOpportunity } = require("./claimHandler");
const { startStatusServer } = require("./statusServer");
const { startCookieRenewal } = require("./cookieRefresher");

const regionName = process.env.DEALER_REGION || "Unknown Region";
const dealerId = Number(process.env.DEALER_ID || 0);
const apiRoot = process.env.POWERPLAY_API_ROOT;
const hubUrl = process.env.POWERPLAY_LEADPOOL_HUB;
const tokenPath = process.env.TOKEN_PATH;
const cookiePath = process.env.COOKIE_PATH;
const statusPort = Number(process.env.STATUS_PORT || process.env.PORT || 0);
const cookieRenewalEnabled = String(process.env.COOKIE_RENEWAL_ENABLED || "true").toLowerCase() === "true";
const cookieRenewalIntervalMin = Number(process.env.COOKIE_RENEWAL_INTERVAL_MIN || 24 * 60);

if (!dealerId || !apiRoot || !hubUrl || !tokenPath) {
    console.error("Missing required env: DEALER_ID, POWERPLAY_API_ROOT, POWERPLAY_LEADPOOL_HUB, TOKEN_PATH");
    process.exit(1);
}

const tokenService = new TokenService({
    regionName,
    tokenFilePath: tokenPath,
    cookieFilePath: cookiePath,
});

const { start } = createLeadPoolConnection({
    hubUrl,
    regionName,
    getAccessToken: () => tokenService.getToken(),
    onLeadAvailable: async ({ opportunityId }) => {
        // Jitter a tiny bit (5–25 ms) to avoid stampede with other workers sharing infra
        const jitter = 5 + Math.floor(Math.random() * 20);
        await new Promise((r) => setTimeout(r, jitter));
        await claimOpportunity({
            apiRoot,
            opportunityId,
            dealerId,
            regionName,
            getAccessToken: () => tokenService.getToken(),
        });
    },
});

start().catch((err) => {
    console.error(`[${regionName}] Fatal hub start error:`, err && err.stack ? err.stack : err);
    process.exit(2);
});

if (statusPort) {
    startStatusServer({
        tokenService,
        regionName,
        dealerId,
        cookiePath,
        port: statusPort,
    });
}

if (cookieRenewalEnabled && cookiePath) {
    startCookieRenewal({
        regionName,
        cookiePath,
        intervalMinutes: cookieRenewalIntervalMin,
        jitterMinutes: 5,
        runOnStartIfMissing: true,
    });
}



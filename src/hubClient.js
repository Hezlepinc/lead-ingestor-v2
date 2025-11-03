"use strict";

const { HubConnectionBuilder, LogLevel } = require("@microsoft/signalr");

function createLeadPoolConnection(options) {
    const {
        hubUrl,
        getAccessToken,
        onLeadAvailable,
        regionName = "Unknown Region",
        logLevel = LogLevel.Information,
    } = options;

    const connection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
            accessTokenFactory: () => getAccessToken(),
        })
        .withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => 500 })
        .configureLogging(logLevel)
        .build();

    connection.on("LeadAvailable", (payload) => {
        try {
            if (!payload) return;
            const opportunityId = payload.opportunityId || payload.id || payload.opportunityID;
            if (!opportunityId) return;
            onLeadAvailable({ opportunityId, raw: payload });
        } catch (err) {
            console.error(`[${regionName}] LeadAvailable handler error:`, err && err.message ? err.message : err);
        }
    });

    async function start() {
        for (;;) {
            try {
                await connection.start();
                console.log(`[${regionName}] 🛰️ Listening for leads...`);
                return;
            } catch (err) {
                console.error(`[${regionName}] Hub start failed, retrying in 1s:`, err && err.message ? err.message : err);
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
    }

    return { connection, start };
}

module.exports = { createLeadPoolConnection };



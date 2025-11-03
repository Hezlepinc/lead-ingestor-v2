"use strict";

const http = require("http");
const fs = require("fs");

function startStatusServer(options) {
    const {
        tokenService,
        regionName,
        dealerId,
        cookiePath,
        port,
    } = options;

    const server = http.createServer((req, res) => {
        if (req.url === "/status") {
            const expiresAt = tokenService.getExpiry();
            const lastRefreshedAt = tokenService.getLastRefreshedAt();
            let cookieStat = null;
            try {
                if (cookiePath) cookieStat = fs.statSync(cookiePath);
            } catch {}

            const now = new Date();
            const msUntilExpiry = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : null;
            const payload = {
                region: regionName,
                dealerId,
                now: now.toISOString(),
                token: {
                    expiresAt: expiresAt ? expiresAt.toISOString() : null,
                    msUntilExpiry,
                    lastRefreshedAt: lastRefreshedAt ? lastRefreshedAt.toISOString() : null,
                },
                cookies: {
                    path: cookiePath || null,
                    lastSavedAt: cookieStat ? cookieStat.mtime.toISOString() : null,
                },
            };
            const body = JSON.stringify(payload, null, 2);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(body);
            return;
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK\n");
    });

    server.listen(port, () => {
        console.log(`[${regionName}] 🩺 Status server listening on :${port}`);
    });

    return server;
}

module.exports = { startStatusServer };



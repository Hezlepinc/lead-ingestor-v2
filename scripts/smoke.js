"use strict";

const { TokenService } = require("../src/auth/tokenService");
const { claimOpportunity } = require("../src/claimHandler");

async function main() {
    const regionName = process.env.DEALER_REGION || "Unknown Region";
    const dealerId = Number(process.env.DEALER_ID || 0);
    const apiRoot = process.env.POWERPLAY_API_ROOT;
    const tokenPath = process.env.TOKEN_PATH;
    const cookiePath = process.env.COOKIE_PATH;
    const opportunityId = process.env.OPPORTUNITY_ID || "";
    const dryRun = String(process.env.DRY_RUN || "true").toLowerCase() === "true";

    if (!apiRoot || !tokenPath) {
        console.error("Missing required env: POWERPLAY_API_ROOT, TOKEN_PATH");
        process.exit(2);
    }

    const tokenService = new TokenService({
        regionName,
        tokenFilePath: tokenPath,
        cookieFilePath: cookiePath,
    });

    const token = tokenService.getToken();

    // Validate token via UserProfile
    let profileStatus = 0;
    try {
        const res = await fetch(`${apiRoot}/UserProfile`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        profileStatus = res.status;
        console.log(`[${regionName}] 🔎 UserProfile status: ${res.status}`);
    } catch (err) {
        console.error(`[${regionName}] ❌ UserProfile fetch failed:`, err && err.message ? err.message : err);
        process.exit(3);
    }

    if (!opportunityId) {
        console.log(`[${regionName}] ✅ Smoke OK (no OPPORTUNITY_ID provided)`);
        return;
    }

    if (!dealerId) {
        console.error("DEALER_ID is required to perform a claim test");
        process.exit(4);
    }

    if (dryRun) {
        console.log(`[${regionName}] 🧪 DRY_RUN on — would claim ${opportunityId} for dealer ${dealerId}`);
        return;
    }

    const result = await claimOpportunity({
        apiRoot,
        opportunityId,
        dealerId,
        regionName,
        getAccessToken: () => tokenService.getToken(),
    });
    console.log(`[${regionName}] 🧪 Claim result: ok=${result.ok} status=${result.status} latencyMs=${result.latencyMs}`);
}

main().catch((err) => {
    console.error("Smoke test error:", err && err.stack ? err.stack : err);
    process.exit(1);
});



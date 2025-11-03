"use strict";

const { performance } = require("perf_hooks");

async function claimOpportunity(options) {
    const {
        apiRoot,
        opportunityId,
        dealerId,
        getAccessToken,
        regionName = "Unknown Region",
    } = options;

    const url = `${apiRoot}/Opportunity/Claim`;
    const body = { opportunityId, dealerId };
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAccessToken()}`,
    };

    const t0 = performance.now();
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
    } catch (err) {
        const dt = Math.round(performance.now() - t0);
        console.error(`[${regionName}] ❌ Claim ${opportunityId} network error in ${dt} ms`, err && err.message ? err.message : err);
        return { ok: false, status: 0, latencyMs: dt };
    }
    const dt = Math.round(performance.now() - t0);

    if (res.status === 401) {
        console.warn(`[${regionName}] ⚠️ 401 on claim — token may be expiring; retrying once after refresh`);
        // allow caller to refresh by calling getAccessToken() again
        const res2 = await fetch(url, {
            method: "POST",
            headers: {
                ...headers,
                Authorization: `Bearer ${getAccessToken()}`,
            },
            body: JSON.stringify(body),
        }).catch(() => null);
        if (res2) {
            const dt2 = Math.round(performance.now() - t0);
            if (res2.ok) console.log(`[${regionName}] 🤖 Claimed ${opportunityId} (${res2.status}) in ${dt2} ms`);
            else console.warn(`[${regionName}] ❗ Claim retry ${opportunityId} -> ${res2.status} in ${dt2} ms`);
            return { ok: res2.ok, status: res2.status, latencyMs: dt2 };
        }
    }

    if (res.ok) console.log(`[${regionName}] 🤖 Claimed ${opportunityId} (${res.status}) in ${dt} ms`);
    else if (res.status === 409) console.log(`[${regionName}] ⛳ Already claimed ${opportunityId} (${res.status}) in ${dt} ms`);
    else console.warn(`[${regionName}] ❗ Claim ${opportunityId} -> ${res.status} in ${dt} ms`);

    return { ok: res.ok, status: res.status, latencyMs: dt };
}

module.exports = { claimOpportunity };



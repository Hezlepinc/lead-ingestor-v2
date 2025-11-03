# 🧠 PowerPlay Behavior & Network Intelligence

> Functional reference for Lead-Ingestor v2

---

## 1. Platform Overview

- Angular SPA at `https://powerplay.generac.com/app/`
- Auth0 login gateway `https://id.generac.com/u/login`
- REST API root `https://powerplay.generac.com/app/powerplay3-server/api`
- SignalR hub `/lead-pool-service/hubs/leadpool`

## 2. Authentication

- Auth0 JWTs stored in SessionStorage as `id_token`
- Token lifetime: ~1h
- Claims include `CrmDealerId`, `roles`, `scope`
- Cookies: `.AspNetCore.Cookies`, `XSRF-TOKEN`

## 3. Lead Distribution Flow

SignalR: LeadAvailable → SPA calls GET /OpportunitySummary/Pending/Dealer → DOM renders Claim button → User click = POST /Opportunity/Claim

pgsql
Copy code

- Ingestor intercepts **before DOM render** by reading the `LeadAvailable` frame directly.

## 4. SignalR Events

| Event                | Meaning                            |
| -------------------- | ---------------------------------- |
| `LeadAvailable`      | New lead assigned to pool          |
| `LeadRemoved`        | Lead expired or claimed by another |
| `OpportunityClaimed` | Confirmation of successful claim   |

## 5. REST Endpoints

| Function    | Endpoint                             | Method | Notes                       |
| ----------- | ------------------------------------ | ------ | --------------------------- |
| Get Pending | `/OpportunitySummary/Pending/Dealer` | GET    | Returns all unclaimed leads |
| Claim Lead  | `/Opportunity/Claim`                 | POST   | `{ opportunityId }`         |
| Lead Detail | `/Opportunity/{id}`                  | GET    | Full opportunity info       |

## 6. UI Behavior

- When `LeadAvailable` fires, Angular calls `/Pending/Dealer` and populates list.
- Each row renders a “Claim” button tied to Opportunity ID.
- Claim button triggers the same POST `/Opportunity/Claim`.

## 7. Timings

| Step                          | Typical Delay |
| ----------------------------- | ------------- |
| SignalR push → DOM update     | 300–700 ms    |
| SignalR push → Ingestor claim | 250–400 ms    |

## 8. Common Failures

| Status | Meaning              | Fix               |
| ------ | -------------------- | ----------------- |
| 401    | Token expired        | Refresh token     |
| 404    | Lead already claimed | Ignore            |
| 500    | PowerPlay internal   | Retry after delay |

## 9. Mapping to Ingestor v2

| PowerPlay Component      | Lead-Ingestor Module  |
| ------------------------ | --------------------- |
| SignalR Lead Pool        | `hubClient.js`        |
| Claim Button Action      | `claimHandler.js`     |
| JWT Auth                 | `tokenService.js`     |
| Dealer UI / Cookie Store | `playwright/login.js` |

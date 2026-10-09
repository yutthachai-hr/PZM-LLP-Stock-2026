# Staging AI Gateway: design, operations and cost (owner approval 5, 9 Oct 2026)

**Approved here:**
- staging only;
- server-to-server;
- Cloudflare Access service authentication;
- secrets only on servers.

**Not approved here:**
- no open localhost tunnel;
- no public unauthenticated API;
- nothing in production.

## Path of one question

```
browser ──(Firebase ID token)──► Pages Function /api/ask  [staging tier only]
                                   │  guard → keyword router → (only if unsure) gateway
                                   │  CF-Access-Client-Id / -Secret  (Pages secrets)
                                   ▼
                     Cloudflare Access app "pzm-ai-staging" (service-token policy only)
                                   ▼
                     Cloudflare Tunnel (cloudflared on the model host, outbound only)
                                   ▼
                     stack/gateway/gateway.mjs  127.0.0.1:7350   (re-verifies the Access JWT)
                         ├─► Laya english  127.0.0.1:7340  (API key added HERE)
                         └─► Reflex        127.0.0.1:7331  (modelless lane only)
```

## Why each control

| Control | Where | What it stops |
|---|---|---|
| No inbound port | cloudflared dials out; every service binds `127.0.0.1` | Anything reaching the host directly |
| Access service-token policy | Cloudflare edge | Any caller but the staging Pages project; browsers never hold the token |
| JWT re-verified (RS256, team certs, audience, issuer, expiry) | gateway | A request that reaches the port some other way. Tested: forged, wrong audience, wrong issuer, expired, unknown key, `alg:none` |
| Requests rebuilt from allowed fields | gateway | Smuggled fields, a caller choosing the checkpoint or the Reflex lane, oversized questions |
| Text only | `aiGateway.ts` sends `{state: text}` | No user, brand, site, ids or database rows ever reach a model |
| Limits | body 16 KB, text 300 chars, ≤3 questions, ≤4 in flight, 2 s upstream timeout | Resource exhaustion |
| Breakers | per upstream in the gateway; per isolate in Pages | A sick model is not hammered; Ask PZM answers without it |
| Logs | route, status, ms, request id; never text or answers | Business data in model or gateway logs |

**Tests:**
- `tests/ai-gateway.test.ts` (9): real HTTP, signed JWTs;
- `tests/functions/ask.test.ts` (19), including a complete AI outage: the same answers as with no
  AI, and no workflow touched.

## Owner set-up (staging), about 30 minutes

1. **Zero Trust → Access → Service Auth → Service Tokens:** create `pzm-staging-pages`. Copy the
   Client ID and Secret **once**.
2. **Zero Trust → Networks → Tunnels:** create `pzm-ai-staging`.
   - Install cloudflared on the model host.
   - Public hostname `ai-staging.<your-domain>` → `http://127.0.0.1:7350`.
3. **Access → Applications:** add self-hosted `ai-staging.<your-domain>` with **one policy:
   Service Auth → that token.** Note the application **AUD** tag.
4. On the model host, save `C:/pzm/stack/secrets/gateway.staging.json` from
   `stack/gateway/config.staging.example.json` (team domain + AUD), then start Laya, Reflex and
   the gateway.
5. **Staging** Pages project secrets:
   - `AI_GATEWAY_URL=https://ai-staging.<your-domain>`
   - `AI_GATEWAY_CLIENT_ID`
   - `AI_GATEWAY_CLIENT_SECRET`
6. **Leave model routing OFF** (do not set `AI_GATEWAY_URL`) until the AI Go/No-Go allows it.
   With the gateway up but unset, it can be exercised for health and latency only.

## Availability

| Host | Availability [estimate] | Notes |
|---|---|---|
| This office PC (i5-10400, 16 GB, no GPU) | ~95–98%: sleeps, Windows updates, power, office internet | Free; must be set to never sleep. Laya takes about 2 GB RAM and all 6 cores during a call. |
| Small cloud VM, 4 vCPU / 8 GB (Singapore) | ~99.5–99.9% | Enough for Laya on CPU (multilingual p95 ~0.25 s here) + Reflex |
| GPU VM | ~99.5–99.9% | Only needed for a local LLM (Qwen/vLLM); not for Laya |

**Ask PZM never depends on it:** gateway down = breaker open = answers from the guard and router.

## Monthly cost [estimates, 9 Oct 2026; check current prices before buying]

| Item | Cost |
|---|---|
| Cloudflare Tunnel + Access (Zero Trust free plan, < 50 users) | 0 |
| Pages Functions for `/api/ask` (staging, low volume) | Within the existing plan |
| Office PC host: about 65 W × 24 h × 30 d ≈ 47 kWh × ~4.2 THB | **≈ 200 THB/month** |
| Cloud VM 4 vCPU / 8 GB (budget providers ↔ hyperscalers) | **≈ 500–2,500 THB/month** |
| GPU VM (only for a local LLM) | ≈ 15,000+ THB/month; not recommended now |
| Firestore reads by Ask PZM | See the AI Go/No-Go §4: bounded per request |

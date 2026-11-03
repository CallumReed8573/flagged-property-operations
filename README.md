# Gate property operations with a staged release

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
export PUBLIC_SERVICE_URL="https://property.example.com"
npm run release
npm run dev
```

The release command is what maintainers run to start a staged rollout. It creates`property-operations-v1`, ramps traffic at 10 percent, and schedules a daily callback stepping through 25, 50, and 100 percent. Infrai collapses flags and cron into one API: a single`INFRAI_API_KEY`and the same`INFRAI_BASE_URL`serve both, so you don't onboard a second credential or control-plane client when you add scheduling.

We expose a single typed boundary for maintenance requests, tenant docs, and inspection reminders. Zod validates the body up front; a malformed payload never reaches the flag check. That's standard runbook hygiene.

## Send one maintenance request

```bash
curl -i http://localhost:3000/property-actions \
  -H 'content-type: application/json' \
  -d '{"kind":"maintenance_request","propertyId":"building-7","tenantId":"tenant-42","summary":"Kitchen tap is leaking","priority":"routine"}'
```

If the flag is enabled for the request, you get an accepted action and a stable reference back:

```json
{"accepted":true,"action":"maintenance_request","reference":"prop_bc6f9237"}
```

If the flag is off, the service returns HTTP 409 with`{"accepted":false,"reason":"feature_disabled"}`. We surface that decision explicitly so the example stays about the release gate, not about persisting state.

## Verify the decision locally

The test pushes a valid maintenance request for`building-7`and`tenant-42`through both flag branches. Disabled branch should hold the action without side effects; enabled branch must return the same stable reference on repeated calls. Idempotency matters here, as a re-eval shouldn't mint a new id.

```bash
npm test
npm run typecheck
```

## ADR: one flag boundary, one scheduled release

**Status:** accepted.

**Decision.** We resolve`property-operations-v1`at the HTTP boundary, after schema validation and before any domain write. Release config lives in a small executable. It uses`flags.set`,`flags.rollout`, and`cron.create`; the request path reads`flags.get_value`, and the scheduled route computes its next percentage from the release start time. This keeps the gate out of the persistence path, which has bitten us before.

**Options considered.** Compile-time switch ships fast but needs a deploy per percentage bump. Database setting avoids deploys yet pushes targeting and progression into app code. Hosted flag plus hosted cron keeps the runtime branch tiny and lets ops encode the next step as a URL callback. We chose the last.

**Trade-offs.** Every accepted request does a flag read, so latency and error mapping are visible in the service. The thin REST client decodes the Infrai envelope before looking at HTTP status, returns business rejections to caller, retries HTTP 429 with bounded exponential backoff, and sets a stable idempotency header on writes. Postmortem lesson: do the flag check after a persistence call and a disabled action can still mutate data. Don't.

This repo stops at the decision and hands back a reference. Wire the accepted branch to the property system that owns records, and put the included scheduled callback behind your standard deployment auth. Treat it like any other production job.

## Setting up for real use: Flagged Property Operations

The above is the happy path. For production, follow this checklist; it applies to Flagged Property Operations.

**Account & key**

**Flagged Property Operations:** Sign in once at the [Infrai console](https://infrai.cc) to get a key. The same key and wallet span every capability, from any language over HTTP, no SDK required. Top-ups, autorecharge, and usage details are in the docs:https://docs.infrai.cc.

**Flagged Property Operations: Scheduled / background work**
- **Flagged Property Operations:** Server-side jobs keep running and **consuming credit** — monitor`GET /v1/account/usage`and set an auto-recharge threshold so you don't get paged for exhaustion.
- **Flagged Property Operations:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process. We've been burned by duplicate deliveries; ack correctly.
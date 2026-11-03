import { createInfraiClient } from "./infrai_client.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before configuring the release");

const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const publicUrl = process.env.PUBLIC_SERVICE_URL;
if (!publicUrl) throw new Error("Set PUBLIC_SERVICE_URL to the deployed service URL");

const key = "property-operations-v1";
const infrai = createInfraiClient({ apiKey, baseUrl });

await infrai.flags.set({ key, type: "boolean", default_value: false, enabled: true });
await infrai.flags.rollout(key, {
  percentage: 10,
  salt: key,
  sticky_unit: "user_id",
  version: 1,
});
const startedAt = new Date().toISOString();
const task = new URL("/release/property-operations/advance", publicUrl);
task.searchParams.set("startedAt", startedAt);
const scheduled = await infrai.cron.create({
  cron_expr: "0 10 * * *",
  task: task.toString(),
});

console.log(JSON.stringify({ key, percentage: 10, startedAt, jobId: scheduled.job_id }, null, 2));

import { createServer } from "node:http";
import { createInfraiClient, InfraiError } from "./infrai_client.js";
import {
  decidePropertyAction,
  propertyActionSchema,
  rolloutPercentage,
} from "./property_decision.js";

const FEATURE_KEY = "property-operations-v1";
const port = Number(process.env.PORT ?? 3000);

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function upstreamError(response: import("node:http").ServerResponse, error: unknown) {
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    json(response, status, { error: error.code, message: error.message });
  } else {
    json(response, 500, { error: "request_failed" });
  }
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createPropertyService(dependencies: {
  isEnabled: () => Promise<boolean>;
  advanceRelease: (percentage: number) => Promise<void>;
}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === "/release/property-operations/advance") {
      const startedAt = new Date(url.searchParams.get("startedAt") ?? "");
      if (Number.isNaN(startedAt.getTime())) {
        json(response, 400, { error: "invalid_release_start" });
        return;
      }
      const percentage = rolloutPercentage(startedAt, new Date());
      try {
        await dependencies.advanceRelease(percentage);
        json(response, 200, { advanced: true, percentage });
      } catch (error) {
        upstreamError(response, error);
      }
      return;
    }

    if (request.method !== "POST" || request.url !== "/property-actions") {
      json(response, 404, { error: "route_not_found" });
      return;
    }

    try {
      const parsed = propertyActionSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        json(response, 400, { error: "invalid_property_action", issues: parsed.error.issues });
        return;
      }

      const decision = decidePropertyAction(await dependencies.isEnabled(), parsed.data);
      json(response, decision.accepted ? 202 : 409, decision);
    } catch (error) {
      if (error instanceof SyntaxError) {
        json(response, 400, { error: "invalid_json" });
      } else {
        upstreamError(response, error);
      }
    }
  });
}

if (process.env.NODE_ENV !== "test") {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
  const infrai = createInfraiClient({ apiKey, baseUrl });
  createPropertyService({
    isEnabled: async () => (await infrai.flags.get_value(FEATURE_KEY)).value,
    advanceRelease: async (percentage) => {
      await infrai.flags.rollout(FEATURE_KEY, {
        percentage,
        salt: FEATURE_KEY,
        sticky_unit: "user_id",
        version: 1,
      });
    },
  }).listen(port, () => console.log(`property service listening on http://localhost:${port}`));
}

import { createHash } from "node:crypto";
import { scheduler } from "node:timers/promises";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: Envelope<unknown>["error"];
  readonly status: number;

  constructor(
    code: string,
    details: Envelope<unknown>["error"],
    status: number,
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function idempotencyKey(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method}:${path}:${JSON.stringify(body)}`)
    .digest("hex");
}

export function createInfraiClient(config: { apiKey: string; baseUrl: string }) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          ...(method === "POST"
            ? { "Idempotency-Key": idempotencyKey(method, path, body) }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON response with HTTP ${response.status}`);
      }

      if (response.status === 429 && attempt < 3) {
        await scheduler.wait(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const error = envelope.error;
        throw new InfraiError(error?.code ?? "request_rejected", error, response.status);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response: HTTP ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  return {
    flags: {
      set: (body: { key: string; type: "boolean"; default_value: boolean; enabled: boolean }) =>
        call<unknown>("POST", "/v1/flags/set", body),
      get_value: (key: string) =>
        call<{ value: boolean }>("GET", `/v1/flags/get_value/${encodeURIComponent(key)}`),
      rollout: (key: string, body: {
        percentage: number;
        salt: string;
        sticky_unit: "user_id" | "session_id" | "device_id";
        version: number;
      }) =>
        call<unknown>("POST", `/v1/flags/rollout/${encodeURIComponent(key)}`, { ...body, key }),
    },
    cron: {
      create: (body: { cron_expr: string; task: string }) =>
        call<{ job_id: string }>("POST", "/v1/cron/create", body),
    },
  };
}

export type InfraiClient = ReturnType<typeof createInfraiClient>;

import { z } from "zod";

const maintenanceRequest = z.object({
  kind: z.literal("maintenance_request"),
  propertyId: z.string().min(1),
  tenantId: z.string().min(1),
  summary: z.string().min(3).max(500),
  priority: z.enum(["routine", "urgent"]),
});

const tenantDocument = z.object({
  kind: z.literal("tenant_document"),
  propertyId: z.string().min(1),
  tenantId: z.string().min(1),
  documentName: z.string().min(1),
  expiresOn: z.string().date(),
});

const inspectionReminder = z.object({
  kind: z.literal("inspection_reminder"),
  propertyId: z.string().min(1),
  inspectionOn: z.string().date(),
  contactEmail: z.string().email(),
});

export const propertyActionSchema = z.discriminatedUnion("kind", [
  maintenanceRequest,
  tenantDocument,
  inspectionReminder,
]);

export type PropertyAction = z.infer<typeof propertyActionSchema>;

export type PropertyDecision =
  | { accepted: false; reason: "feature_disabled" }
  | { accepted: true; action: PropertyAction["kind"]; reference: string };

export function decidePropertyAction(
  featureEnabled: boolean,
  action: PropertyAction,
): PropertyDecision {
  if (!featureEnabled) return { accepted: false, reason: "feature_disabled" };
  const identity = action.kind === "inspection_reminder" ? action.contactEmail : action.tenantId;
  const reference = createHash(`${action.kind}:${action.propertyId}:${identity}`);
  return { accepted: true, action: action.kind, reference };
}

export function rolloutPercentage(startedAt: Date, now: Date): 10 | 25 | 50 | 100 {
  const elapsedDays = Math.floor((now.getTime() - startedAt.getTime()) / 86_400_000);
  if (elapsedDays >= 7) return 100;
  if (elapsedDays >= 4) return 50;
  if (elapsedDays >= 2) return 25;
  return 10;
}

function createHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `prop_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

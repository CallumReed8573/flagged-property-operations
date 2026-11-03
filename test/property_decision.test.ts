import assert from "node:assert/strict";
import test from "node:test";
import {
  decidePropertyAction,
  propertyActionSchema,
  rolloutPercentage,
} from "../src/property_decision.js";

const request = {
  kind: "maintenance_request",
  propertyId: "building-7",
  tenantId: "tenant-42",
  summary: "Kitchen tap is leaking",
  priority: "routine",
} as const;

test("a valid maintenance request is held while the feature is disabled", () => {
  const action = propertyActionSchema.parse(request);
  assert.deepEqual(decidePropertyAction(false, action), {
    accepted: false,
    reason: "feature_disabled",
  });
});

test("the same request gets a stable reference after enablement", () => {
  const action = propertyActionSchema.parse(request);
  const first = decidePropertyAction(true, action);
  const second = decidePropertyAction(true, action);
  assert.equal(first.accepted, true);
  assert.deepEqual(first, second);
  if (first.accepted) assert.match(first.reference, /^prop_[0-9a-f]{8}$/);
});

test("the scheduled release advances through fixed stages", () => {
  const started = new Date("2026-01-01T10:00:00Z");
  assert.equal(rolloutPercentage(started, new Date("2026-01-02T10:00:00Z")), 10);
  assert.equal(rolloutPercentage(started, new Date("2026-01-03T10:00:00Z")), 25);
  assert.equal(rolloutPercentage(started, new Date("2026-01-05T10:00:00Z")), 50);
  assert.equal(rolloutPercentage(started, new Date("2026-01-08T10:00:00Z")), 100);
});

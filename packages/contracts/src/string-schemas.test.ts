import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agentSessionControlSummarySchema } from "./agent-session-control-schemas";
import { agentUserMessageEventSchema } from "./agent-session-event-schemas";
import { agentSessionLiveSnapshotSchema } from "./agent-session-live-schemas";
import { appUpdateStateSchema } from "./app-update-schemas";
import { notificationOsDeliveryRequestSchema } from "./notification-schemas";
import { pullRequestReviewCheckSchema } from "./pull-request-review-schemas";
import { withMaxUtf16Length } from "./string-schemas";
import { taskAssetStageInputSchema, taskAssetStageResultSchema } from "./task-asset-schemas";
import {
  terminalIdSchema,
  terminalPreparePathInputRequestSchema,
  terminalPreparePathInputResponseSchema,
} from "./terminal-schemas";

describe("string length compatibility", () => {
  test.each([
    ["task asset input name", taskAssetStageInputSchema.shape.originalName, 255],
    ["task asset result name", taskAssetStageResultSchema.shape.originalName, 255],
    ["terminal ID", terminalIdSchema, 128],
    ["terminal path", terminalPreparePathInputRequestSchema.shape.paths.element, 32_768],
    ["terminal path text", terminalPreparePathInputResponseSchema.shape.text, 262_144],
    ["notification title", notificationOsDeliveryRequestSchema.shape.title, 180],
    ["notification body", notificationOsDeliveryRequestSchema.shape.body, 500],
  ] as const)("keeps the UTF-16 limit for %s", (_name, schema, maximum) => {
    const atLimit = "😀".repeat(Math.floor(maximum / 2)) + (maximum % 2 ? "a" : "");
    expect(schema.parse(atLimit)).toBe(atLimit);
    for (const value of [`${atLimit}a`, "a".repeat(maximum + 1)]) {
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      if (result.success) throw new Error("over-limit input must fail");
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({
        code: "too_big",
        origin: "string",
        maximum,
        inclusive: true,
      });
    }
  });

  test("keeps trimming, field paths, and JSON-schema limits", () => {
    const name = withMaxUtf16Length(z.string().trim().min(1), 2);
    const schema = z.object({ name });
    expect(schema.parse({ name: "  😀  " })).toEqual({ name: "😀" });
    const result = schema.safeParse({ name: "😀a" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("over-limit input must fail");
    expect(result.error.issues[0]?.path).toEqual(["name"]);
    expect(z.toJSONSchema(name)).toMatchObject({ type: "string", minLength: 1, maxLength: 2 });
    expect(name.safeParse(42).success).toBe(false);
    expect(name.safeParse(" ").success).toBe(false);
  });
});

describe("runtime timestamp compatibility", () => {
  test.each([
    ["session events", agentUserMessageEventSchema.shape.timestamp],
    ["live sessions", agentSessionLiveSnapshotSchema.shape.startedAt],
    ["session control", agentSessionControlSummarySchema.shape.startedAt],
    ["pull request checks", pullRequestReviewCheckSchema.shape.startedAt.unwrap()],
    ["app update checks", appUpdateStateSchema.options[0].shape.checkedAt.unwrap()],
  ] as const)("accepts existing timestamp precision in %s", (_name, schema) => {
    for (const value of [
      "2026-09-11T12:34Z",
      "2026-09-11T12:34+02:00",
      "2026-09-11T12:34:56Z",
      "2026-09-11T12:34:56.123456-05:00",
      "2024-02-29T12:34Z",
    ]) {
      expect(schema.parse(value)).toBe(value);
    }
    for (const value of [
      "2025-02-29T12:34Z",
      "2026-09-11T24:34Z",
      "2026-09-11T12:60Z",
      "2026-09-11T12:34:60Z",
      "2026-09-11T12:34",
      "2026-09-11",
      "not a timestamp",
    ]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

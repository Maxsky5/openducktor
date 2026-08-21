import { describe, expect, test } from "bun:test";
import {
  parsePermissionAsked,
  parseQuestionAsked,
  parseSessionStatus,
  readSessionErrorMessage,
} from "./schemas";

describe("event-stream schemas", () => {
  test("parseSessionStatus rejects unknown status types", () => {
    expect(() =>
      parseSessionStatus({
        status: {
          type: "reconnect",
          attempt: 4,
          message: "Backoff",
          next: 900,
        },
      }),
    ).toThrow("unsupported status type 'reconnect'");
  });

  test("parseSessionStatus rejects a missing status type", () => {
    expect(() => parseSessionStatus({ status: {} })).toThrow("missing status.type");
  });

  test("parseSessionStatus rejects incomplete retry payloads", () => {
    for (const status of [
      { type: "retry", attempt: 1, message: "Retrying" },
      { type: "retry", attempt: 1, message: "   ", next: 500 },
      { type: "retry", message: "Retrying", next: 500 },
    ]) {
      expect(() => parseSessionStatus({ status })).toThrow(
        "numeric attempt and next values plus a non-blank message",
      );
    }
  });

  test("parsePermissionAsked normalizes invalid patterns as empty list", () => {
    expect(
      parsePermissionAsked({
        id: "perm-1",
        permission: "write",
        patterns: ["src/**", 12],
      }),
    ).toEqual({
      requestId: "perm-1",
      permission: "write",
      patterns: [],
    });
  });

  test("parsePermissionAsked maps the OpenCode v2 action and resources", () => {
    expect(
      parsePermissionAsked({
        id: "perm-v2-1",
        action: "write",
        resources: ["src/**"],
        metadata: { tool: "edit" },
      }),
    ).toEqual({
      requestId: "perm-v2-1",
      permission: "write",
      patterns: ["src/**"],
      metadata: { tool: "edit" },
    });
  });

  test("parsePermissionAsked does not use resources when present patterns are malformed", () => {
    expect(
      parsePermissionAsked({
        id: "perm-1",
        permission: "write",
        patterns: [12],
        resources: ["src/**"],
      }),
    ).toEqual({
      requestId: "perm-1",
      permission: "write",
      patterns: [],
    });
  });

  test("parseQuestionAsked filters malformed questions and options", () => {
    expect(
      parseQuestionAsked({
        id: "q-1",
        questions: [
          {
            header: "Pick one",
            question: "Select",
            options: [{ label: "A", description: "Option A" }, { label: "B" }],
          },
          {
            header: "Missing options",
            question: "Broken",
          },
        ],
      }),
    ).toEqual({
      requestId: "q-1",
      questions: [
        {
          header: "Pick one",
          question: "Select",
          options: [{ label: "A", description: "Option A" }],
        },
        {
          header: "Missing options",
          question: "Broken",
          options: [],
        },
      ],
    });
  });

  test("readSessionErrorMessage falls back when nested message is absent", () => {
    expect(readSessionErrorMessage({ error: { data: {} } })).toBe("Unknown session error");
  });
});

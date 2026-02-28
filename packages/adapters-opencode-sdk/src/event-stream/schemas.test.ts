import { describe, expect, test } from "bun:test";
import {
  parsePermissionAsked,
  parseQuestionAsked,
  parseSessionStatus,
  readSessionErrorMessage,
} from "./schemas";

describe("event-stream schemas", () => {
  test("parseSessionStatus maps unknown type to retry payload", () => {
    expect(
      parseSessionStatus({
        status: {
          type: "reconnect",
          attempt: 4,
          message: "Backoff",
          next: 900,
        },
      }),
    ).toEqual({
      type: "retry",
      attempt: 4,
      message: "Backoff",
      nextEpochMs: 900,
    });
  });

  test("parseSessionStatus maps missing type to retry defaults", () => {
    expect(parseSessionStatus({ status: {} })).toEqual({
      type: "retry",
      attempt: 0,
      message: "Retrying session",
      nextEpochMs: 0,
    });
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

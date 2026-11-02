import { describe, expect, test } from "bun:test";
import {
  type CompactableAgentSessionRecord,
  compactAgentSessionRecord,
} from "./agent-session-records";

const createSession = (
  overrides: Partial<CompactableAgentSessionRecord> = {},
): CompactableAgentSessionRecord => ({
  externalSessionId: " session-1 ",
  role: " build ",
  startedAt: " 2026-06-19T01:00:00.000Z ",
  runtimeKind: " opencode ",
  workingDirectory: " /repo ",
  selectedModel: {
    runtimeKind: " opencode ",
    providerId: "openai",
    modelId: "gpt-5",
  },
  ...overrides,
});

describe("compactAgentSessionRecord", () => {
  test("trims durable session identity fields and selected model runtime kind", () => {
    const result = compactAgentSessionRecord(createSession());

    expect(result).toEqual({
      success: true,
      session: {
        externalSessionId: "session-1",
        role: "build",
        startedAt: "2026-06-19T01:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      },
    });
  });

  test("requires working directory on every persisted session", () => {
    const result = compactAgentSessionRecord(createSession({ workingDirectory: " " }));

    expect(result).toEqual({
      success: false,
      error: {
        field: "workingDirectory",
        message: "Agent session workingDirectory is required",
      },
    });
  });

  test("requires selected model runtime kind when a selected model is present", () => {
    const result = compactAgentSessionRecord(
      createSession({
        selectedModel: {
          runtimeKind: " ",
          providerId: "openai",
          modelId: "gpt-5",
        },
      }),
    );

    expect(result).toEqual({
      success: false,
      error: {
        field: "selectedModel.runtimeKind",
        message: "Agent session selectedModel.runtimeKind is required",
      },
    });
  });
});

describe("task session start timestamps", () => {
  test.each([
    ["2026-06-19T03:30:00.123+02:30", "2026-06-19T01:00:00.123Z"],
    ["1969-12-31T23:59:59.999000Z", "1969-12-31T23:59:59.999Z"],
    ["2024-02-29T24:00:00Z", "2024-03-01T00:00:00.000Z"],
    ["-271821-04-19T23:00:00-01:00", "-271821-04-20T00:00:00.000Z"],
    ["+275760-09-13T01:00:00+01:00", "+275760-09-13T00:00:00.000Z"],
  ])("normalizes %s without changing its instant", (startedAt, expected) => {
    const result = compactAgentSessionRecord(createSession({ startedAt }));
    expect(result.success && result.session.startedAt).toBe(expected);
  });

  test.each([
    "2023-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-06-19T00:00:00",
    "2026-06-19T00:00:00.123001Z",
    "2026-06-19T00:00:00+24:00",
    "2026-06-19T24:00:00.001Z",
    "+275760-09-13T00:00:00.001Z",
    "-271821-04-19T23:59:59.999Z",
    "-000000-01-01T00:00:00Z",
  ])("rejects invalid or lossy start timestamp %s", (startedAt) => {
    expect(compactAgentSessionRecord(createSession({ startedAt }))).toMatchObject({
      success: false,
      error: { field: "startedAt" },
    });
  });
});

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

  test("omits undefined optional selection fields from the durable record", () => {
    const result = compactAgentSessionRecord(
      createSession({
        runtimeKind: "codex",
        selectedModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5.6",
          profileId: undefined,
        },
      }),
    );

    expect(result).toStrictEqual({
      success: true,
      session: {
        externalSessionId: "session-1",
        role: "build",
        startedAt: "2026-06-19T01:00:00.000Z",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        selectedModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5.6",
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

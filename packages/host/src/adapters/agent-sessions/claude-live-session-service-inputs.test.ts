import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  requireClaudePolicy,
  toClaudeSendInput,
  toClaudeStartInput,
} from "./claude-live-session-service-inputs";

describe("Claude live-session service inputs", () => {
  test("rejects control inputs routed to a different runtime", async () => {
    await expect(Effect.runPromise(requireClaudePolicy("codex", "start-session"))).rejects.toThrow(
      "requires a Claude runtime",
    );
  });

  test("maps public inputs without leaking present undefined optional fields", () => {
    const startInput = toClaudeStartInput({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Build",
      model: undefined,
    });
    const sendInput = toClaudeSendInput({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      parts: [
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            path: "/repo/worktree/image.png",
            name: "image.png",
            kind: "image",
            mime: undefined,
          },
        },
      ],
      model: undefined,
      systemPrompt: undefined,
    });

    expect(startInput).toEqual({
      repoPath: "/repo",
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
      workingDirectory: "/repo/worktree",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Build",
    });
    expect(sendInput).toEqual({
      repoPath: "/repo",
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      parts: [
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            path: "/repo/worktree/image.png",
            name: "image.png",
            kind: "image",
          },
        },
      ],
    });
  });
});

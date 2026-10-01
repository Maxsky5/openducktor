import { expect, test } from "bun:test";
import {
  AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS,
  policyBoundSessionRefSchema,
} from "./agent-runtime-query-command-contracts";

import { HOST_COMMAND_NAMES } from "./host-command-contracts";

const ref = { repoPath: "/repo", workingDirectory: "/repo/task", externalSessionId: "native" };
for (const runtimeKind of ["opencode", "claude", "codex"] as const) {
  test(`${runtimeKind} preserves display inputs and rejects mismatched policies`, () => {
    const input = {
      ...ref,
      runtimeKind,
      runtimePolicy:
        runtimeKind === "codex"
          ? {
              kind: runtimeKind,
              policy: {
                sandboxMode: "workspace-write",
                approvalPolicy: "on-request",
                approvalsReviewer: "user",
                commandNetworkAccess: false,
                approvalsReviewerApplies: true,
              },
            }
          : { kind: runtimeKind },
      sessionScope: { kind: "repository" },
      systemPrompt: "Context",
      model: { providerId: "native", modelId: "model" },
    };
    expect(policyBoundSessionRefSchema.parse(input)).toEqual(input);
    expect(
      policyBoundSessionRefSchema.safeParse({
        ...input,
        runtimePolicy: { kind: runtimeKind === "claude" ? "opencode" : "claude" },
      }).success,
    ).toBe(false);
    expect(
      policyBoundSessionRefSchema.safeParse({ ...input, endpoint: "http://127.0.0.1:7777" })
        .success,
    ).toBe(false);
  });
}

test("requires a positive history limit and preserves prompt context and diff anchors", () => {
  const input = { ...ref, runtimeKind: "opencode", runtimePolicy: { kind: "opencode" } };
  for (const limit of [0, -1, 0.5])
    expect(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionHistory.inputSchema.safeParse({
        ...input,
        limit,
      }).success,
    ).toBe(false);
  const history = {
    ...input,
    limit: 20,
    systemPromptContext: { systemPrompt: "Saved", startedAt: "2026-09-10T00:00:00Z" },
  };
  expect(
    AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionHistory.inputSchema.parse(history),
  ).toEqual(history);
  expect(
    AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionDiff.inputSchema.parse({
      ...ref,
      runtimeKind: "opencode",
      runtimeHistoryAnchor: "turn",
    }).runtimeHistoryAnchor,
  ).toBe("turn");
});

test("requires a workflow scope for session metadata and returns epoch milliseconds or null", () => {
  const { inputSchema, responseSchema } = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionMetadata;
  const input = {
    ...ref,
    runtimeKind: "codex",
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  };
  expect(inputSchema.parse(input)).toEqual(input);
  expect(inputSchema.safeParse({ ...input, sessionScope: { kind: "repository" } }).success).toBe(
    false,
  );
  expect(inputSchema.safeParse({ ...ref, runtimeKind: "codex" }).success).toBe(false);
  expect(inputSchema.safeParse({ ...input, runtimePolicy: { kind: "codex" } }).success).toBe(false);

  const liveRef = { ...ref, runtimeKind: "codex" };
  expect(responseSchema.parse({ ref: liveRef, lastActivityAt: 1_790_000_000_000 })).toEqual({
    ref: liveRef,
    lastActivityAt: 1_790_000_000_000,
  });
  expect(responseSchema.parse({ ref: liveRef, lastActivityAt: null }).lastActivityAt).toBeNull();
  for (const lastActivityAt of [-1, 1.5, "2026-09-30T00:00:00Z"])
    expect(responseSchema.safeParse({ ref: liveRef, lastActivityAt }).success).toBe(false);
});

test("retires native frontend query bridges", () => {
  expect(
    HOST_COMMAND_NAMES.some(
      (name) => name.startsWith("claude_") || name === "codex_app_server_request",
    ),
  ).toBe(false);
});

test("keeps the combined catalog read on the complete-catalog input contract", () => {
  const input = { repoPath: "/repo", runtimeKind: "opencode", workingDirectory: "/repo/worktree" };
  const schema = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadCatalog.inputSchema;
  expect(schema.parse(input)).toEqual(input);
  expect(schema.safeParse({ ...input, surfaces: ["models"] }).success).toBe(false);
});

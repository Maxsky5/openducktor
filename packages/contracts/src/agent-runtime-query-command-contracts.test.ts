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

test("retires native frontend query bridges", () => {
  expect(
    HOST_COMMAND_NAMES.some(
      (name) => name.startsWith("claude_") || name === "codex_app_server_request",
    ),
  ).toBe(false);
});

import { expect, test } from "bun:test";
import type { AgentSessionScope, CodexEffectivePolicy } from "@openducktor/contracts";
import { Effect } from "effect";
import { createCodexSessionImportAdapter } from "./codex-session-import";

const codexPolicy: CodexEffectivePolicy = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  commandNetworkAccess: false,
  approvalsReviewerApplies: true,
};

const request = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread-1",
  sessionScope: { kind: "repository" as const, workspaceId: "workspace-1" },
};

test("opens an imported native session with the scope of the import request", async () => {
  const policyScopes: AgentSessionScope[] = [];
  const opened: unknown[] = [];
  const adapter = createCodexSessionImportAdapter(
    {
      listSessionMetadataPage: async () => {
        throw new Error("Unexpected listing");
      },
      openExistingSession: async (input) => {
        opened.push(input);
        return {
          metadata: {
            externalSessionId: input.externalSessionId,
            runtimeKind: "codex",
            workingDirectory: input.workingDirectory,
            title: "Imported",
            updatedAt: null,
          },
          selectedModel: null,
          attach: async () => {},
        };
      },
    },
    "runtime-1",
    (input) => {
      policyScopes.push(input.sessionScope);
      return Effect.succeed(codexPolicy);
    },
    () => Effect.void,
  );

  await Effect.runPromise(adapter.inspectSession(request));

  expect(policyScopes).toEqual([request.sessionScope]);
  expect(opened).toEqual([{ ...request, runtimePolicy: { kind: "codex", policy: codexPolicy } }]);
});

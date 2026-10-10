import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { createWorkspaceArchivedSessionsPort } from "./archived-sessions-port";

const archivedRecord = (externalSessionId: string): WorkspaceSession => ({
  id: externalSessionId,
  runtimeKind: "codex",
  externalSessionId,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/alpha" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: 2000,
});

const archivedKey = (externalSessionId: string): string =>
  agentSessionIdentityKey({
    runtimeKind: "codex",
    externalSessionId,
    workingDirectory: "/alpha",
  });

const failLatestRead = async (client: QueryClient, workspaceId: string): Promise<void> => {
  await client
    .fetchQuery({
      queryKey: workspaceSessionQueryKeys.list(workspaceId, true),
      queryFn: () => Promise.reject(new Error("archived list read failed")),
      retry: false,
    })
    .catch(() => undefined);
};

describe("createWorkspaceArchivedSessionsPort", () => {
  test("reports unknown while the archived list has no state", () => {
    const client = new QueryClient();
    try {
      expect(createWorkspaceArchivedSessionsPort(client).read("alpha")).toEqual({
        status: "unknown",
      });
    } finally {
      client.clear();
    }
  });

  test("reports the archived identity keys of the workspace", () => {
    const client = new QueryClient();
    try {
      client.setQueryData(workspaceSessionQueryKeys.list("alpha", true), [archivedRecord("a")]);

      expect(createWorkspaceArchivedSessionsPort(client).read("alpha")).toEqual({
        status: "ready",
        keys: new Set([archivedKey("a")]),
      });
    } finally {
      client.clear();
    }
  });

  test("reports the read failure instead of the data of the last success", async () => {
    const client = new QueryClient();
    try {
      client.setQueryData(workspaceSessionQueryKeys.list("alpha", true), [archivedRecord("a")]);
      await failLatestRead(client, "alpha");

      expect(createWorkspaceArchivedSessionsPort(client).read("alpha")).toEqual({
        status: "error",
        reason: "archived list read failed",
      });
    } finally {
      client.clear();
    }
  });
});

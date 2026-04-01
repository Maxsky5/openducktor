import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { host } from "../operations/host";
import { ensureRuntimeListFromQuery, loadRuntimeListFromQuery } from "./runtime";

const runtimeFixture: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/tmp/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-03-22T09:00:00.000Z",
  descriptor: {
    kind: "opencode",
    label: "OpenCode",
    description: "runtime",
    capabilities: {
      provisioningMode: "host_managed",
      supportedScopes: ["workspace"],
      supportsDiff: true,
      supportsFileStatus: true,
      supportsFileSearch: true,
      supportsMcpStatus: true,
      supportsOdtWorkflowTools: true,
      supportsPermissionRequests: true,
      supportsProfiles: true,
      supportsQueuedUserMessages: true,
      supportsQuestionRequests: true,
      supportsSessionFork: true,
      supportsSlashCommands: true,
      supportsTodos: true,
      supportsVariants: true,
    },
    readOnlyRoleBlockedTools: [],
  },
};

describe("runtime queries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  test("ensureRuntimeListFromQuery reuses cached runtime data without refetching", async () => {
    const runtimeList = mock(async () => [runtimeFixture]);
    const originalRuntimeList = host.runtimeList;
    host.runtimeList = runtimeList;

    try {
      await loadRuntimeListFromQuery(queryClient, "opencode", "/tmp/repo");
      expect(runtimeList).toHaveBeenCalledTimes(1);

      await ensureRuntimeListFromQuery(queryClient, "opencode", "/tmp/repo");
      expect(runtimeList).toHaveBeenCalledTimes(1);
    } finally {
      host.runtimeList = originalRuntimeList;
      queryClient.clear();
    }
  });
});

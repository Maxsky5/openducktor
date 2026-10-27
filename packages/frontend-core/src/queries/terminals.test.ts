import { expect, test } from "bun:test";
import type { TerminalListResponse } from "@openducktor/contracts";
import { QueryClient, skipToken } from "@tanstack/react-query";
import { terminalListByFilterQueryOptions, terminalQueryKeys } from "./terminals";
import { createTestClientConnection } from "../test-support/test-client-connection";

test("a paused terminal read keeps its owner's cached list", () => {
  const filter = { kind: "task" as const, repoPath: "/repo", taskId: "task-1" };
  const cached = { hostInstanceId: "host-1", terminals: [] };
  const client = new QueryClient();
  client.setQueryData(terminalQueryKeys.filter(filter), cached);

  const options = terminalListByFilterQueryOptions({ filter, enabled: false });

  expect(options.enabled).toBe(false);
  expect(client.getQueryData<TerminalListResponse>([...options.queryKey])).toEqual(cached);
});

test("a terminal read with no owner cannot fetch a broad list", () => {
  const options = terminalListByFilterQueryOptions({ filter: null });

  expect([...options.queryKey]).toEqual([...terminalQueryKeys.skipped]);
  expect(options.queryFn).toBe(skipToken);
});

test.each(["host", "replacement-host"])(
  "a held %s refresh applies metadata and removals without losing a confirmed result from the same host",
  async (hostInstanceId) => {
    const response = Promise.withResolvers<TerminalListResponse>();
    const connection = createTestClientConnection({
      client: { terminalList: () => response.promise },
      scheduleTask: () => () => {},
    });
    const filter = { kind: "task" as const, repoPath: "/repo", taskId: "task" };
    const options = terminalListByFilterQueryOptions({ filter });
    const terminal = {
      terminalId: "action-terminal",
      label: "Install dependencies",
      context: { repoPath: "/repo", taskId: "task" },
      initialWorkingDir: "/repo",
      createdAt: "2026-10-27T12:00:00.000Z",
      lifecycle: "running" as const,
      exit: null,
      startedBy: "host" as const,
    };
    connection.queryClient.setQueryData(options.queryKey, {
      hostInstanceId: "host",
      terminals: [terminal, { ...terminal, terminalId: "removed" }],
    });
    const read = connection.queryClient.fetchQuery(options);
    const result = {
      type: "exited" as const,
      exitCode: 1,
      signal: null,
      outputTail: ["Install failed."],
    };
    try {
      connection.queryClient.setQueryData(options.queryKey, {
        hostInstanceId: "host",
        terminals: [
          { ...terminal, initialCommandResult: result },
          { ...terminal, terminalId: "removed", initialCommandResult: result },
        ],
      });
      response.resolve({
        hostInstanceId,
        terminals: [
          {
            ...terminal,
            label: "Renamed action",
            lifecycle: "exited",
            exit: {
              exitCode: 0,
              signal: null,
              finalSequence: 12,
              exitedAt: "2026-10-27T12:01:00.000Z",
            },
          },
        ],
      });
      await read;
      const cached = connection.queryClient.getQueryData<TerminalListResponse>(options.queryKey);
      expect(cached?.hostInstanceId).toBe(hostInstanceId);
      expect(cached?.terminals).toHaveLength(1);
      expect(cached?.terminals[0]).toMatchObject({
        label: "Renamed action",
        lifecycle: "exited",
        exit: { exitCode: 0, finalSequence: 12 },
      });
      expect(cached?.terminals[0]?.initialCommandResult).toEqual(
        hostInstanceId === "host" ? result : undefined,
      );
    } finally {
      response.resolve({ hostInstanceId, terminals: [] });
      await read;
      await connection.dispose();
    }
  },
);

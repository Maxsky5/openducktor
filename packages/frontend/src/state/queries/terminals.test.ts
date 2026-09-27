import { expect, test } from "bun:test";
import type { TerminalListResponse } from "@openducktor/contracts";
import { QueryClient, skipToken } from "@tanstack/react-query";
import { terminalListByFilterQueryOptions, terminalQueryKeys } from "./terminals";

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

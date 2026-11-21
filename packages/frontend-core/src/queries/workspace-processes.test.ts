import { describe, expect, mock, test } from "bun:test";
import type {
  WorkspaceProcessList,
  WorkspaceProcessRow,
  WorkspaceProcessStopResponse,
  WorkspaceProcessStopResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  readProcessActionState,
  stopWorkspaceProcesses,
  workspaceProcessQueryKeys,
  workspaceProcessesQueryOptions,
} from "./workspace-processes";

const row = (processRef: string): WorkspaceProcessRow => ({
  processRef,
  pid: Number(processRef.split(":")[0]),
  name: "node",
  command: "node server.js",
  stop: { allowed: true, requiresPidReuseAcknowledgment: false, forced: false },
  listeners: [],
});

const list = (...processRefs: string[]): WorkspaceProcessList => ({
  issues: [],
  groups: [
    {
      workspaceId: "repo",
      workspaceName: "Repo",
      checkoutPath: "/repo",
      kind: "repository",
      owners: [],
      processes: processRefs.map(row),
    },
  ],
});

const request = { workspaceId: "repo", checkoutPath: "/repo", processRefs: ["7:70"] };
const issue = { message: "The process changed.", nextAction: "Refresh the list." };

/** The response of the host for the processes of a request that all get one result. */
const respond =
  (result: WorkspaceProcessStopResult) =>
  async ({ processRefs }: { processRefs: string[] }): Promise<WorkspaceProcessStopResponse> => ({
    results: processRefs.map((processRef) => ({ processRef, result })),
  });

/** The outcome of the only process of a request. */
const stopOne = async (...args: Parameters<typeof stopWorkspaceProcesses>) =>
  (await stopWorkspaceProcesses(...args))[0]?.outcome;

const setup = (
  stop: (request: { processRefs: string[] }) => Promise<WorkspaceProcessStopResponse>,
  read: () => Promise<WorkspaceProcessList> = async () => list("8:80"),
) => {
  const { queryClient } = createTestClientConnection({
    client: { workspaceProcessStop: mock(stop), workspaceProcessesList: read },
  });
  queryClient.setQueryData(workspaceProcessQueryKeys.all, list("7:70", "8:80"));
  return { queryClient };
};

const cachedRefs = (queryClient: ReturnType<typeof setup>["queryClient"]) =>
  queryClient
    .getQueryData<WorkspaceProcessList>(workspaceProcessQueryKeys.all)
    ?.groups.flatMap((group) => group.processes.map((process) => process.processRef)) ?? [];

const isOutdated = (queryClient: ReturnType<typeof setup>["queryClient"], processRef: string) =>
  readProcessActionState(queryClient).outdated.has(processRef);

describe("workspace process queries", () => {
  test("reads the list with the request signal", async () => {
    const workspaceProcessesList = mock<HostClient["workspaceProcessesList"]>(async () =>
      list("7:70"),
    );
    const { queryClient } = createTestClientConnection({ client: { workspaceProcessesList } });
    await queryClient.fetchQuery(workspaceProcessesQueryOptions());
    expect(workspaceProcessesList.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("removes every stopped process of one request from the cache", async () => {
    const { queryClient } = setup(respond({ kind: "already_exited" }));
    const outcomes = await stopWorkspaceProcesses(queryClient, {
      ...request,
      processRefs: ["7:70", "8:80"],
    });
    expect(outcomes.map(({ outcome }) => outcome.kind)).toEqual(["removed", "removed"]);
    expect(cachedRefs(queryClient)).toEqual([]);
  });

  test("keeps the row for an outcome that the host could not confirm", async () => {
    const { queryClient } = setup(respond({ kind: "out_of_date", issue }));
    expect(await stopOne(queryClient, request)).toEqual({
      kind: "stale",
      result: { kind: "out_of_date", issue },
    });
    expect(cachedRefs(queryClient)).toEqual(["7:70", "8:80"]);
  });

  test("reports a lost reply", async () => {
    const error = new Error("The connection closed.");
    const { queryClient } = setup(async () => {
      throw error;
    });
    expect(await stopOne(queryClient, request)).toEqual({ kind: "lost", error });
  });
});

test("keeps a stale row disabled until a later host read lists it", async () => {
  const results: WorkspaceProcessStopResult[] = [
    { kind: "out_of_date", issue },
    { kind: "stopped" },
  ];
  let release = () => {};
  const { queryClient } = setup(
    (stopRequest) => respond(results.shift() ?? { kind: "stopped" })(stopRequest),
    // The refresh after each outcome waits, so only the explicit read below finishes.
    () =>
      new Promise<WorkspaceProcessList>((resolve) => {
        release = () => resolve(list("7:70"));
      }),
  );
  await stopWorkspaceProcesses(queryClient, request);
  await stopWorkspaceProcesses(queryClient, { ...request, processRefs: ["8:80"] });
  expect(cachedRefs(queryClient)).toEqual(["7:70"]);
  expect(isOutdated(queryClient, "7:70")).toBe(true);

  await queryClient.cancelQueries();
  const read = queryClient.fetchQuery(workspaceProcessesQueryOptions());
  release();
  await read;
  expect(isOutdated(queryClient, "7:70")).toBe(false);
});

test("keeps a stop pending for the connection until its outcome", async () => {
  const outcome = Promise.withResolvers<WorkspaceProcessStopResult>();
  const { queryClient } = setup(async (stopRequest) => respond(await outcome.promise)(stopRequest));
  const stop = stopWorkspaceProcesses(queryClient, request);
  expect(readProcessActionState(queryClient).pending.has("7:70")).toBe(true);
  outcome.resolve({ kind: "stopped" });
  await stop;
  expect(readProcessActionState(queryClient).pending.has("7:70")).toBe(false);
});

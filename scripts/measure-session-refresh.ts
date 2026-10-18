// Compare task-change session refresh traffic before and after the batched session-list reads.
// Run from packages/frontend, so the frontend test preload and path aliases apply:
//   SESSION_REFRESH_BASELINE=<commit> bun test ../../scripts/measure-session-refresh.ts
// The baseline commit must contain the per-task refresh in agent-sessions.ts.
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  Agent,
  createServer as createHttpServer,
  request as httpRequest,
  type Server,
} from "node:http";
import { createRequire } from "node:module";
import { type AddressInfo, connect, createServer as createTcpServer, type Socket } from "node:net";
import path from "node:path";
import type {
  AgentSessionRecord,
  ExternalTaskSyncEvent,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { createSqliteTaskStoreHarness } from "../packages/host/src/adapters/sqlite/sqlite-task-store-test-support";
import * as after from "../packages/frontend-core/src/queries/agent-session-view-sync";
import * as afterQueries from "../packages/frontend-core/src/queries/agent-sessions";

const root = path.resolve(import.meta.dir, "..");
const baselineCommit = process.env.SESSION_REFRESH_BASELINE;
const baselineDir = path.join(root, "packages/frontend/src/state", `.session-refresh-baseline`);
const hostRequire = createRequire(path.join(root, "packages/host/package.json"));
const frontendRequire = createRequire(path.join(root, "packages/frontend/package.json"));
const { Effect } = await import(hostRequire.resolve("effect"));
// Use the Query module that the measured frontend code imports.
const { QueryClient, QueryObserver }: typeof import("@tanstack/react-query") = await import(
  frontendRequire.resolve("@tanstack/react-query")
);
const serverDelayMs = 25;
const trials = 7;
const sizes = [1, 100];

type Counts = {
  sessionListRequests: number;
  liveSessionRefreshRequests: number;
  requestBytes: number;
  responseBytes: number;
};

/** The body of a fixture host command. */
type FixtureCommandInput = { repoPath: string; taskId?: string; taskIds?: string[] };

const listen = (server: Server | ReturnType<typeof createTcpServer>): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      // SAFETY: a server that listens on a TCP port reports an AddressInfo address.
      resolve((server.address() as AddressInfo).port);
    });
  });

test("measures task-change session refresh traffic against host records", async () => {
  if (!baselineCommit) {
    throw new Error("Set SESSION_REFRESH_BASELINE to the commit before the batched reads.");
  }
  await mkdir(baselineDir, { recursive: true });
  for (const file of ["agent-sessions.ts", "agent-session-view-sync.ts"]) {
    const source = execFileSync(
      "git",
      ["show", `${baselineCommit}:packages/frontend/src/state/queries/${file}`],
      { cwd: root, encoding: "utf8" },
    );
    await writeFile(path.join(baselineDir, file), source);
  }
  const fixture = await createSqliteTaskStoreHarness({
    repoPath: "/repos/session-refresh",
    workspaceId: "session-refresh",
  });
  try {
    const before = await import(path.join(baselineDir, "agent-session-view-sync.ts"));
    const beforeQueries = await import(path.join(baselineDir, "agent-sessions.ts"));
    const repoPath = fixture.repoPath;
    const taskIds: string[] = [];
    // Every fifth task has no session. The others have one or two sessions with a model.
    for (let index = 0; index < 100; index += 1) {
      const task = await Effect.runPromise(
        fixture.store.createTask({
          repoPath,
          task: { title: `Task ${index}`, issueType: "task", priority: 2 },
        }),
      );
      taskIds.push(task.id);
      if (index % 5 === 4) continue;
      for (let sessionIndex = 0; sessionIndex < (index % 2) + 1; sessionIndex += 1) {
        await Effect.runPromise(
          fixture.store.upsertAgentSession({
            repoPath,
            taskId: task.id,
            session: {
              externalSessionId: `session-${index}-${sessionIndex}`,
              runtimeKind: "opencode",
              workingDirectory: `/repos/session-refresh/worktree-${index}`,
              role: sessionIndex ? "spec" : "build",
              startedAt: "2026-10-04T12:00:00.000Z",
              selectedModel: {
                runtimeKind: "opencode",
                providerId: "fixture",
                modelId: "fixture-model",
                variant: "default",
              },
            },
          }),
        );
      }
    }
    const hostRecords: TaskAgentSessions[] = await Effect.runPromise(
      fixture.store.listAgentSessionsForTasks({ repoPath, taskIds }),
    );
    const expected = new Map(hostRecords.map((entry) => [entry.taskId, entry.agentSessions]));
    const results = [];
    for (const size of sizes) {
      for (const phase of ["before", "after"] as const) {
        const samples: (Counts & { completionMs: number })[] = [];
        for (let trial = 0; trial < trials; trial += 1) {
          const scope = taskIds.slice(0, size);
          const counts: Counts = {
            sessionListRequests: 0,
            liveSessionRefreshRequests: 0,
            requestBytes: 0,
            responseBytes: 0,
          };
          const http = createHttpServer(async (request, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const input = JSON.parse(Buffer.concat(chunks).toString());
            await Bun.sleep(serverDelayMs);
            let result: AgentSessionRecord[] | TaskAgentSessions[] | null = null;
            if (request.url === "/live") {
              counts.liveSessionRefreshRequests += 1;
            } else {
              counts.sessionListRequests += 1;
              const ids = request.url === "/single" ? [input.taskId] : input.taskIds;
              const records: TaskAgentSessions[] = await Effect.runPromise(
                fixture.store.listAgentSessionsForTasks({ repoPath: input.repoPath, taskIds: ids }),
              );
              result = request.url === "/single" ? records[0]!.agentSessions : records;
            }
            const body = JSON.stringify(result);
            response.writeHead(200, {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            });
            response.end(body);
          });
          const serverPort = await listen(http);
          // The proxy counts every byte on the wire, including headers and framing.
          const sockets = new Set<Socket>();
          const proxy = createTcpServer((socket) => {
            const upstream = connect(serverPort, "127.0.0.1");
            sockets.add(socket);
            sockets.add(upstream);
            socket.on("data", (bytes) => {
              counts.requestBytes += bytes.length;
            });
            upstream.on("data", (bytes) => {
              counts.responseBytes += bytes.length;
            });
            socket.pipe(upstream);
            upstream.pipe(socket);
            socket.on("close", () => upstream.destroy());
            upstream.on("close", () => socket.destroy());
          });
          const proxyPort = await listen(proxy);
          const agent = new Agent({ keepAlive: true });
          const send = <Result>(command: string, input: FixtureCommandInput): Promise<Result> =>
            new Promise((resolve, reject) => {
              const body = JSON.stringify(input);
              const call = httpRequest(
                {
                  host: "127.0.0.1",
                  port: proxyPort,
                  path: `/${command}`,
                  method: "POST",
                  agent,
                  headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                  },
                },
                (response) => {
                  const chunks: Buffer[] = [];
                  response.on("data", (chunk: Buffer) => chunks.push(chunk));
                  response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
                },
              );
              call.on("error", reject);
              call.end(body);
            });
          const port = {
            agentSessionsList: (repo: string, taskId: string) =>
              send<AgentSessionRecord[]>("single", { repoPath: repo, taskId }),
            agentSessionsListForTasks: (repo: string, ids: string[]) =>
              send<TaskAgentSessions[]>("batch", { repoPath: repo, taskIds: ids }),
            taskIdsList: async () => taskIds,
          };
          const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          // Each affected task has a mounted view with a loaded empty list.
          const stops = scope.map((taskId) => {
            queryClient.setQueryData(["agent-sessions", "list", repoPath, taskId], []);
            const options =
              phase === "before"
                ? beforeQueries.agentSessionListQueryOptions(repoPath, taskId, port)
                : afterQueries.agentSessionListQueryOptions(repoPath, taskId, port);
            return new QueryObserver(queryClient, options).subscribe(() => {});
          });
          const event: ExternalTaskSyncEvent = {
            kind: "tasks_updated",
            eventId: `trial-${trial}`,
            repoPath,
            taskIds: scope,
            removedTaskIds: [],
            statusChanges: [],
            taskSnapshots: [],
            emittedAt: "2026-10-04T12:00:00.000Z",
          };
          const syncOptions = {
            queryClient,
            readPort: port,
            listSessionTaskIds: () => [],
            removeTaskSessions: () => {},
            refreshLiveSessions: (repo: string) =>
              send<null>("live", { repoPath: repo }).then(() => {}),
          };
          const started = performance.now();
          if (phase === "before") {
            await before.createAgentSessionViewSync(syncOptions).reconcileExternalEvent(event);
          } else {
            const sync = after.createAgentSessionViewSync(syncOptions);
            await sync.completeExternalEvents([sync.admitExternalEvent(event)], () => true);
          }
          const completionMs = performance.now() - started;
          for (const taskId of scope) {
            expect(
              queryClient.getQueryData<AgentSessionRecord[]>([
                "agent-sessions",
                "list",
                repoPath,
                taskId,
              ]),
            ).toEqual(expected.get(taskId)!);
          }
          samples.push({ ...counts, completionMs: Number(completionMs.toFixed(2)) });
          for (const stop of stops) stop();
          queryClient.clear();
          agent.destroy();
          for (const socket of sockets) socket.destroy();
          http.closeAllConnections();
          await new Promise((resolve) => http.close(resolve));
          await new Promise((resolve) => proxy.close(resolve));
        }
        const sorted = [...samples].sort((left, right) => left.completionMs - right.completionMs);
        results.push({
          affectedTasks: size,
          phase,
          median: sorted[Math.floor(trials / 2)],
          samples,
        });
      }
    }
    console.log(
      JSON.stringify(
        {
          baselineCommit,
          measuredAt: new Date().toISOString(),
          environment: { bun: Bun.version, platform: process.platform, arch: process.arch },
          trials,
          serverDelayMs,
          listsMatchHostRecords: true,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.cleanup();
    await rm(baselineDir, { recursive: true, force: true });
  }
}, 120_000);

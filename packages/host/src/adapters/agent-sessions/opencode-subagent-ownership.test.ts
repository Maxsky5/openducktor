import { describe, expect, test } from "bun:test";
import {
  createPrepareOpencodeSessionRuntime,
  type OpencodeStreamEventLog,
} from "@openducktor/adapters-opencode-sdk";
import { taskMetadataPayloadSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { requireSessionScope } from "../../application/runtimes/runtime-query-scope";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { PreparedOpenCodeLiveSessionAdapter } from "./opencode-live-session-adapter";
import {
  createLifecycle,
  createTestOpenCodeLiveSessionAdapterPreparer,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

describe("OpenCode subagent ownership", () => {
  test.each(["unregistered", "registered"])(
    "keeps an unrelated %s root out of the task and keeps observing",
    async (registration) => {
      const other = { ...ref, externalSessionId: "ses_other_root" };
      const scope = { kind: "workflow", taskId: "task-1", role: "build" } as const;
      const model = { providerID: "test", id: "test-model" };
      const snapshot = {
        id: "msg_continue",
        type: "assistant",
        time: { created: 2 },
        agent: "build",
        model,
        content: [
          {
            type: "tool",
            id: "call_continue",
            name: "subagent",
            time: { created: 3 },
            state: { status: "streaming", input: "" },
          },
        ],
      };
      const requests: string[] = [];
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      const push = (event: OpencodeStreamEventLog["event"]) => {
        if (!stream) throw new Error("Expected a native event subscription.");
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          const path = url.pathname;
          requests.push(path);
          if (path === "/api/event")
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  stream = controller;
                  push({ id: "connected", type: "server.connected", data: {} });
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            );
          if (path === "/api/info")
            return Response.json({ version: "2.0.24", pid: 42, urls: [], paths: { tmp: "/tmp" } });
          if (path.endsWith("/migration/v1")) return Response.json({ status: "completed" });
          if (path === "/api/location")
            return Response.json({
              directory: ref.workingDirectory,
              project: { id: "project-1", directory: ref.repoPath, canonical: ref.repoPath },
            });
          if (path === "/api/session/active") return Response.json({ data: {} });
          if (path.endsWith("/message") || path === "/api/session")
            return Response.json({
              data: path === `/api/session/${ref.externalSessionId}/message` ? [snapshot] : [],
              cursor: { next: null, prev: null },
            });
          if (path.endsWith("/instructions/entries") || /\/(permission|form|inbox)$/.test(path))
            return Response.json({ data: [] });
          const root = [ref, other].find(
            (entry) => path === `/api/session/${entry.externalSessionId}`,
          );
          if (root)
            return Response.json({
              data: {
                id: root.externalSessionId,
                title: root === ref ? "Task session" : "Unrelated session",
                projectID: "project-1",
                location: { directory: root.workingDirectory },
                time: { created: 1, updated: 2 },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                model,
              },
            });
          throw new Error(`Unexpected native request ${request.method} ${path}`);
        },
      });
      const prepareRuntime = createPrepareOpencodeSessionRuntime({
        resolveCreationSettings: async () => ({ defaults: [], role: [] }),
        resolveMcpServerConfig: async () => ({ command: ["test-bridge"], environment: {} }),
        readDirectory: async (_directory, read) => read(),
      });
      const changes: AgentSessionLiveAdapterChange[] = [];
      const observed = Promise.withResolvers<void>();
      const lost: string[] = [];
      let prepared: PreparedOpenCodeLiveSessionAdapter | undefined;
      try {
        prepared = await Effect.runPromise(
          createTestOpenCodeLiveSessionAdapterPreparer({
            liveSessionLifecycle: createLifecycle(changes),
            prepareRuntime: async (input) => {
              const native = await prepareRuntime(input);
              return {
                ...native,
                startForwarding: (listener) =>
                  native.startForwarding(async (signal) => {
                    await listener(signal);
                    if (signal.type === "fault" || signal.type === "session_fault")
                      observed.reject(new Error(signal.message));
                    if (signal.type === "runtime_notice" && signal.message === "Still observing")
                      observed.resolve();
                  }),
              };
            },
          })(
            { ...runtime, runtimeRoute: { type: "local_http", endpoint: server.url.origin } },
            {
              onObservationLost: (message) => {
                lost.push(message);
              },
              onCleanupFailed: () => {},
            },
          ),
        );
        const refresh = prepared.adapter.refreshSnapshots;
        if (!refresh) throw new Error("Expected OpenCode to refresh snapshots.");
        await Effect.runPromise(
          refresh(ref.repoPath, [
            { ...ref, sessionScope: scope },
            ...(registration === "registered"
              ? [{ ...other, sessionScope: { kind: "repository" as const } }]
              : []),
          ]),
        );
        await Effect.runPromise(prepared.startForwarding());
        changes.length = 0;
        push({
          id: "evt_continue_input",
          type: "session.tool.input.ended",
          created: 4,
          durable: { aggregateID: ref.externalSessionId, seq: 1, version: 1 },
          data: {
            sessionID: ref.externalSessionId,
            assistantMessageID: snapshot.id,
            id: "call_continue",
            text: JSON.stringify({
              sessionID: other.externalSessionId,
              agent: "general",
              prompt: "Continue",
            }),
          },
        });
        push({
          id: "evt_parent_started",
          type: "session.execution.started",
          created: 5,
          durable: { aggregateID: ref.externalSessionId, seq: 2, version: 1 },
          data: { sessionID: ref.externalSessionId },
        });
        push({
          id: "evt_observed",
          type: "tui.toast.show",
          created: 6,
          data: { message: "Still observing", variant: "warning" },
        });
        await observed.promise;

        const metadata = taskMetadataPayloadSchema.parse({
          spec: {},
          plan: {},
          agentSessions: [{ ...ref, role: "build", startedAt: new Date(1).toISOString() }],
        });
        const runtimePolicy = { kind: "opencode" } as const;
        const input = { ...other, sessionScope: scope, runtimePolicy };
        const requestsBeforeRead = requests.length;
        const read = await Effect.runPromise(
          Effect.result(
            requireSessionScope(
              { getTaskMetadata: () => Effect.succeed(metadata) },
              prepared.adapter,
              input,
              "loadSessionHistory",
            ).pipe(Effect.andThen(prepared.adapter.queries.loadSessionHistory(input))),
          ),
        );
        expect(read).toMatchObject({ failure: { failure: { code: "scope_mismatch" } } });
        expect(
          requests
            .slice(requestsBeforeRead)
            .includes(`/api/session/${other.externalSessionId}/message`),
        ).toBe(false);
        const snapshots = await Effect.runPromise(prepared.adapter.listSnapshots());
        expect(
          snapshots.find(({ ref: entry }) => entry.externalSessionId === other.externalSessionId)
            ?.parentExternalSessionId,
        ).toBeUndefined();
        expect(snapshots.map(({ ref: entry }) => entry.externalSessionId).sort()).toEqual(
          (registration === "registered"
            ? [ref.externalSessionId, other.externalSessionId]
            : [ref.externalSessionId]
          ).sort(),
        );
        expect(
          snapshots.find(({ ref: entry }) => entry.externalSessionId === ref.externalSessionId)
            ?.activity,
        ).toBe("running");
        expect(lost).toEqual([]);
        expect(changes.some((change) => change.type === "fault")).toBe(false);
        expect(
          await Effect.runPromise(
            prepared.adapter.queries.loadSessionHistory({ ...ref, runtimePolicy }),
          ),
        ).toHaveLength(1);
      } finally {
        try {
          if (prepared) await Effect.runPromise(prepared.discard());
        } finally {
          await server.stop(true);
        }
      }
    },
  );
});

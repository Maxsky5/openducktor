import { expect, test } from "bun:test";
import { createPrepareOpencodeSessionRuntime } from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import {
  createLifecycle,
  createTestOpenCodeLiveSessionAdapterPreparer,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

test("projects native V2 approvals through the host and replies to the native request", async () => {
  const installed = new Set<string>();
  const replies: { path: string; body: unknown }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const directory = url.searchParams.get("location[directory]") ?? "/repo";
      if (path === "/api/info")
        return Response.json({ version: "2.0.24", pid: 42, urls: [], paths: { tmp: "/tmp" } });
      if (path === "/api/event")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ id: "connected", type: "server.connected", data: {} })}\n\n`,
                ),
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      if (path.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (path.endsWith("/instructions/entries")) return Response.json({ data: [] });
      if (path === "/api/mcp")
        return Response.json({
          location: { directory },
          data: installed.has(directory)
            ? [{ name: "openducktor", status: { status: "connected" } }]
            : [],
        });
      if (path === "/api/experimental/mcp/openducktor") {
        installed.add(directory);
        return new Response(null, { status: 204 });
      }
      if (path === "/api/location")
        return Response.json({
          directory,
          project: { id: "project-1", directory: "/repo", canonical: "/repo" },
        });
      if (path === "/api/session/active") return Response.json({ data: {} });
      if (path.endsWith("/permission"))
        return Response.json({
          data: [
            {
              id: "permission_native",
              sessionID: ref.externalSessionId,
              action: "shell",
              resources: ["bun test"],
              save: ["bun test*"],
            },
          ],
        });
      if (path.endsWith("/reply")) {
        replies.push({ path, body: await request.json() });
        return new Response(null, { status: 204 });
      }
      if (/\/(form|inbox)$/.test(path)) return Response.json({ data: [] });
      if (path === "/api/session" || path.endsWith("/message"))
        return Response.json({ data: [], cursor: { next: null, prev: null } });
      if (path === `/api/session/${ref.externalSessionId}` && request.method === "PATCH")
        return new Response(null, { status: 204 });
      if (path === `/api/session/${ref.externalSessionId}`)
        return Response.json({
          data: {
            id: ref.externalSessionId,
            title: "Linked conversation",
            projectID: "project-1",
            location: { directory: ref.workingDirectory },
            time: { created: 1, updated: 2 },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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
  const prepare = createTestOpenCodeLiveSessionAdapterPreparer({
    liveSessionLifecycle: createLifecycle(changes),
    prepareRuntime,
  });
  try {
    const prepared = await Effect.runPromise(
      prepare({
        ...runtime,
        runtimeRoute: { type: "local_http", endpoint: server.url.origin },
      }),
    );
    try {
      if (!prepared.adapter.refreshSnapshots) throw new Error("Expected native snapshots");
      await Effect.runPromise(
        prepared.adapter.refreshSnapshots(ref.repoPath, [
          { ...ref, sessionScope: { kind: "repository" } },
        ]),
      );
      expect(changes.filter((change) => change.type === "fault")).toEqual([]);
      const read = await Effect.runPromise(prepared.adapter.readSnapshot(ref));
      if (read.type !== "live") throw new Error("Expected the linked native conversation");
      const approval = read.session.pendingApprovals[0]!;
      expect(approval).toMatchObject({
        action: { name: "shell" },
        supportedReplyOutcomes: ["approve_once", "approve_always", "reject"],
        persistentGrant: {
          scope: "project",
          projectDirectory: "/repo",
          rules: [{ action: "shell", resource: "bun test*" }],
        },
        rejectsAllPendingApprovals: true,
      });
      expect(approval.requestId).not.toBe("permission_native");
      await Effect.runPromise(
        prepared.adapter.replyApproval({
          ...ref,
          requestId: approval.requestId,
          outcome: "approve_always",
        }),
      );
      expect(replies).toEqual([
        {
          path: `/api/session/${ref.externalSessionId}/permission/permission_native/reply`,
          body: { decision: "always" },
        },
      ]);
    } finally {
      await Effect.runPromise(prepared.discard());
    }
  } finally {
    await server.stop(true);
  }
});

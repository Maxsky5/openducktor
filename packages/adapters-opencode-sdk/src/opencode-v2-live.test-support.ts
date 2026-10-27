import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import type { ManagedMcpServerResolver } from "@openducktor/core";
import {
  createPrepareOpencodeSessionRuntime,
  type PreparedOpencodeSessionRuntime,
} from "./opencode-session-runtime";
import {
  connection,
  ref,
  session,
  response,
  noContent,
  cursorPage,
  location,
  model,
  nativeClient,
  eventChannel,
  type NativeRequest,
  testWorkflowRolePolicy,
} from "./opencode-v2.test-support";

export const prepareFixture = (
  override?: (request: NativeRequest) => Response | Promise<Response> | undefined,
  resolveMcpServerConfig: ManagedMcpServerResolver = async () => ({
    command: ["odt-mcp"],
    environment: { OPENDUCKTOR_WORKSPACE_ID: "workspace-1" },
  }),
): Fixture => {
  const channel = eventChannel();
  const requests: NativeRequest[] = [];
  const installed = new Set<string>();
  const detail: SessionInfo = session();
  const handleRequest = (request: NativeRequest): Response | Promise<Response> => {
    requests.push(request);
    const overridden = override?.(request);
    if (overridden) return overridden;
    const { url, method } = request;
    const directory = url.searchParams.get("location[directory]") ?? ref.workingDirectory;
    if (url.pathname === "/api/info")
      return Response.json({ version: "2.0.24", pid: 42, urls: [], paths: { tmp: "/tmp" } });
    if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
    if (url.pathname === "/api/mcp")
      return Response.json({
        location: { directory },
        data: installed.has(directory)
          ? [{ name: "openducktor", status: { status: "connected" } }]
          : [],
      });
    if (url.pathname === "/api/experimental/mcp/openducktor") {
      installed.add(directory);
      return noContent();
    }
    if (url.pathname === "/api/location") return Response.json(location);
    if (url.pathname === "/api/session/active") return response({});
    if (url.pathname === "/api/session") return cursorPage([]);
    if (url.pathname.endsWith("/message")) return cursorPage([]);
    if (url.pathname.endsWith("/instructions/entries")) return response([]);
    if (/\/(permission|form|inbox)$/.test(url.pathname)) return response([]);
    if (method === "PATCH") return noContent();
    if (url.pathname === "/api/session/ses_saved") return response(detail);
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  };
  const prepare = createPrepareOpencodeSessionRuntime({
    createClient: (_connection, signal) => {
      const client = nativeClient(handleRequest, signal);
      client.event.subscribe = channel.subscribe;
      return client;
    },
    resolveCreationSettings: async () => ({ defaults: [], role: [] }),
    resolveWorkflowRolePolicy: testWorkflowRolePolicy,
    resolveMcpServerConfig,
    readDirectory: async (_directory, read) => read(),
  });
  return {
    requests,
    channel,
    prepare: () =>
      prepare({
        runtimeId: connection.runtimeId,
        runtimeEndpoint: connection.endpoint,
        connection,
      }),
  };
};

export const durable = { aggregateID: ref.externalSessionId, seq: 1, version: 1 as const };

export const backgroundLaunch = (): SessionMessageInfo => ({
  id: "msg_launch",
  type: "assistant",
  time: { created: 2, completed: 5 },
  agent: "build",
  model,
  content: [
    {
      type: "tool",
      id: "call_child",
      name: "subagent",
      time: { created: 3, ran: 4, completed: 5 },
      state: {
        status: "completed",
        input: { agent: "research", prompt: "Find references", background: true },
        content: [{ type: "text", text: "Started" }],
        metadata: { sessionID: "ses_child", status: "running" },
      },
    },
  ],
});

type Fixture = {
  requests: NativeRequest[];
  channel: ReturnType<typeof eventChannel>;
  prepare: () => Promise<PreparedOpencodeSessionRuntime>;
};

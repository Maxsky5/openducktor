import {
  OpenCode,
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageInfo,
  type V2Event,
} from "@opencode/client";
import type { AgentSessionScope, OpenCodeCreationSettings } from "@openducktor/contracts";
import { z, type JSONType } from "zod";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";
import type { OpenCodeRuntimeConnection } from "./types";
import { OPENCODE_WORKFLOW_PLUGIN_ID } from "./opencode-workflow-plugin";

export const workflowPluginResponse = () => Response.json({ output: { ready: true } });

export const connection: OpenCodeRuntimeConnection = {
  runtimeId: "runtime-1",
  endpoint: "http://127.0.0.1:4096",
  authentication: { type: "basic", username: "opencode", password: "test-private-password" },
};
export const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  externalSessionId: "ses_saved",
};
export const model = { providerID: "test", id: "test-model" };
export const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: ref.externalSessionId,
  projectID: "project-1",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/repo" },
  model,
  ...overrides,
});
export type NativeRequest = {
  method: string;
  url: URL;
  body: Record<string, JSONType>;
  signal?: AbortSignal;
};
export const nativeClient = (
  handle: (request: NativeRequest) => Response | Promise<Response>,
  signal?: AbortSignal,
): OpenCodeClient =>
  OpenCode.make({
    baseUrl: connection.endpoint,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${connection.authentication.password}`).toString("base64")}`,
    },
    fetch: Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const body =
          init?.body !== undefined && init.body !== null
            ? z
                .custom<Record<string, JSONType>>(
                  (value) => z.record(z.string(), z.json()).safeParse(value).success,
                )
                .parse(JSON.parse(z.string().parse(init.body)))
            : {};
        return handle({
          url,
          method: init?.method ?? "GET",
          body,
          ...(signal ? { signal } : init?.signal ? { signal: init.signal } : {}),
        });
      },
      { preconnect: () => {} },
    ),
  });
export const response = <Data>(data: Data) => Response.json({ data });
export const noContent = () => new Response(null, { status: 204 });
export const location = {
  directory: "/repo",
  project: { id: "project-1", directory: "/repo", canonical: "/repo" },
};
export const cursorPage = (data: SessionMessageInfo[], next: string | null = null) =>
  Response.json({ data, cursor: { next, prev: null } });

type NativeControllerFixture = {
  controller: OpencodeSdkAdapter;
  client: OpenCodeClient;
  requests: NativeRequest[];
};

export const createController = (
  handle: (request: NativeRequest) => Response | Promise<Response>,
  settings: OpenCodeCreationSettings = { defaults: [], role: [] },
): NativeControllerFixture => {
  const requests: NativeRequest[] = [];
  const client = nativeClient((request) => {
    requests.push(request);
    if (request.url.pathname === `/api/rpc/${OPENCODE_WORKFLOW_PLUGIN_ID}/bind`)
      return workflowPluginResponse();
    return handle(request);
  });
  const controller = new OpencodeSdkAdapter(
    connection,
    {
      createClient: () => client,
      resolveCreationSettings: async (_scope: AgentSessionScope) => settings,
    },
    {
      readDirectory: async (_directory, read) => read(),
      ensureMcp: async () => {},
      admitted: () => {},
    },
  );
  return { controller, requests, client };
};
export const eventChannel = () => {
  const events: V2Event[] = [{ id: "connected-1", type: "server.connected", data: {} }];
  let wake: (() => void) | undefined;
  return {
    push: (event: V2Event) => {
      events.push(event);
      wake?.();
    },
    subscribe: ({ signal }: { signal?: AbortSignal } = {}) => ({
      async *[Symbol.asyncIterator]() {
        const onAbort = () => wake?.();
        signal?.addEventListener("abort", onAbort);
        try {
          while (!signal?.aborted) {
            const event = events.shift();
            if (event) yield event;
            else
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
          }
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      },
    }),
  };
};

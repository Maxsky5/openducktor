import { expect, test } from "bun:test";
import type { SessionInfo } from "@opencode/client";
import type { RpcHandlers } from "@opencode/plugin/promise/rpc";
import type { Context } from "@opencode/plugin/promise/plugin";
import type { SessionHooks } from "@opencode/plugin/promise/session";
import { z } from "zod";
import { createOpenCodeClient } from "../opencode-client";
import { installOpenCodePolicy } from "../opencode-permissions";
import { OPENCODE_WORKFLOW_PLUGIN_RPC } from "../opencode-workflow-plugin";
import {
  connection,
  location,
  model,
  ref,
  session,
  response,
  noContent,
} from "../opencode-v2.test-support";
import plugin from "./server";

const fixture = async () => {
  const sessions = new Map<string, SessionInfo>([[ref.externalSessionId, session()]]);
  const entries = new Map<string, string>();
  const hooks = new Map<string, (sessionID: string) => Promise<void>>();
  let rpc!: RpcHandlers<typeof OPENCODE_WORKFLOW_PLUGIN_RPC>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (
        request.headers.get("Authorization") !==
        `Basic ${Buffer.from(`opencode:${connection.authentication.password}`).toString("base64")}`
      )
        return new Response(null, { status: 401 });
      const url = new URL(request.url);
      if (url.pathname === "/api/location") return Response.json(location);
      const rpcMethod = url.pathname.match(
        /\/api\/rpc\/openducktor-workflow-instructions\/(bind|ready)$/,
      )?.[1];
      if (rpcMethod) {
        const body = z.object({ input: z.unknown() }).parse(await request.json());
        const callContext = {
          signal: request.signal,
          error: () => {
            throw new Error("Unexpected RPC error factory");
          },
        };
        const output =
          rpcMethod === "bind"
            ? await rpc.bind(body.input, callContext)
            : await rpc.ready({}, callContext);
        return Response.json({ output });
      }
      const instruction = url.pathname.match(
        /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries(?:\/openducktor.workflow)?$/,
      );
      if (instruction) {
        const id = instruction[1]!;
        if (request.method === "PUT") {
          entries.set(id, z.object({ value: z.string() }).parse(await request.json()).value);
          return noContent();
        }
        const value = entries.get(id);
        return response(value === undefined ? [] : [{ key: "openducktor.workflow", value }]);
      }
      const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1];
      if (sessionID && request.method === "PATCH") {
        const update = z
          .object({
            metadata: z.record(z.string(), z.json()),
            permissions: z.array(
              z.object({
                action: z.string(),
                resource: z.string(),
                effect: z.enum(["allow", "ask", "deny"]),
              }),
            ),
          })
          .parse(await request.json());
        sessions.set(sessionID, { ...sessions.get(sessionID)!, ...update });
        return noContent();
      }
      throw new Error(`Unexpected native request ${request.method} ${url.pathname}`);
    },
  });
  try {
    // The native plugin host supplies these public hook and RPC registration boundaries.
    // SAFETY: This native-host double supplies the session and RPC boundaries used by this plugin.
    const context = {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => {
          const detail = sessions.get(sessionID);
          if (!detail) throw new Error(`Unknown native session ${sessionID}`);
          return detail;
        },
        hook: async <Name extends keyof SessionHooks>(
          name: Name,
          callback: (input: SessionHooks[Name]) => Promise<void> | void,
        ) => {
          hooks.set(name, async (sessionID) => {
            const input =
              name === "prompt"
                ? { sessionID, messageID: "msg_1", prompt: { text: "Check" }, delivery: "prompt" }
                : {
                    sessionID,
                    agent: "build",
                    model,
                    system: [],
                    messages: [],
                    options: {},
                    tools: {},
                  };
            // SAFETY: Each registered hook receives its native payload, with IDs from SessionInfo.
            await callback(input as SessionHooks[Name]);
          });
          return {
            dispose: async () => {
              hooks.delete(name);
            },
          };
        },
      },
      rpc: {
        register: async (
          _definition: typeof OPENCODE_WORKFLOW_PLUGIN_RPC,
          handlers: RpcHandlers<typeof OPENCODE_WORKFLOW_PLUGIN_RPC>,
        ) => {
          rpc = handlers;
          return { dispose: async () => {}, events: { emit: async () => {} } };
        },
      },
    } as Context;
    await plugin.setup(context);
    const nativeConnection = { ...connection, endpoint: server.url.origin };
    const client = createOpenCodeClient(nativeConnection);
    await installOpenCodePolicy({
      connection: nativeConnection,
      client,
      detail: sessions.get(ref.externalSessionId)!,
      identity: ref,
      scope: { kind: "workflow", taskId: "task-1", role: "planner" },
      systemPrompt: "Stored custom Planner instructions for task-1.",
    });
    const parent = sessions.get(ref.externalSessionId)!;
    const child = { ...parent, id: "ses_child", parentID: parent.id };
    sessions.set(child.id, child);
    return {
      sessions,
      entries,
      parent,
      child,
      client,
      invoke: (name: "prompt" | "context") => hooks.get(name)!(child.id),
      close: () => server.stop(true),
    };
  } catch (cause) {
    server.stop(true);
    throw cause;
  }
};

test("copies the parent's stored prompt before admission and checks it before model execution", async () => {
  const f = await fixture();
  try {
    await expect(f.invoke("context")).rejects.toThrow(
      "no confirmed OpenDucktor workflow instructions",
    );
    await f.invoke("prompt");
    expect(f.entries.get(f.child.id)).toBe("Stored custom Planner instructions for task-1.");
    await f.invoke("context");
    await f.client.rpc(OPENCODE_WORKFLOW_PLUGIN_RPC).ready({});
  } finally {
    f.close();
  }
});

test.each(["Stored child override.", ""])(
  "keeps a child's existing instruction entry and rejects an empty entry: %s",
  async (prompt) => {
    const f = await fixture();
    try {
      f.entries.set(f.child.id, prompt);
      for (const hook of ["prompt", "context"] as const) {
        if (prompt) await f.invoke(hook);
        else
          await expect(f.invoke(hook)).rejects.toThrow(
            "no confirmed OpenDucktor workflow instructions",
          );
      }
      expect(f.entries.get(f.child.id)).toBe(prompt);
    } finally {
      f.close();
    }
  },
);

test.each(["id", "directory", "owner", "missing instructions"])(
  "blocks child admission for a parent with mismatched %s",
  async (mismatch) => {
    const f = await fixture();
    try {
      if (mismatch === "id") f.sessions.set(f.parent.id, { ...f.parent, id: "ses_other" });
      if (mismatch === "directory")
        f.sessions.set(f.parent.id, { ...f.parent, location: { directory: "/other" } });
      if (mismatch === "owner")
        f.sessions.set(f.parent.id, { ...f.parent, metadata: {}, permissions: [] });
      if (mismatch === "missing instructions") f.entries.delete(f.parent.id);
      await expect(f.invoke("prompt")).rejects.toThrow(
        mismatch === "missing instructions"
          ? "no confirmed OpenDucktor workflow instructions"
          : "same workflow owner and directory",
      );
      expect(f.entries.has(f.child.id)).toBe(false);
    } finally {
      f.close();
    }
  },
);

test.each(["repository child", "workflow root"])("does not change a %s", async (kind) => {
  const f = await fixture();
  try {
    const detail =
      kind === "repository child"
        ? session({ id: f.child.id, parentID: f.parent.id })
        : session({ ...f.parent, id: f.child.id });
    f.sessions.set(f.child.id, detail);
    await f.invoke("prompt");
    await f.invoke("context");
    expect(f.entries.has(f.child.id)).toBe(false);
  } finally {
    f.close();
  }
});

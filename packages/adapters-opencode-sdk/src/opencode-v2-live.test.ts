import { describe, expect, test } from "bun:test";
import type { SessionInfo, SessionInboxInfo, SessionMessageInfo, V2Event } from "@opencode/client";
import { z } from "zod";
import type { AgentSessionHistoryMessage, ManagedMcpServerResolver } from "@openducktor/core";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  hostEventEnvelopeSchema,
} from "@openducktor/contracts";
import { createPrepareOpencodeSessionRuntime } from "./opencode-session-runtime";
import { OpenCodeOperationError } from "./opencode-client";
import { OpenCodeMessageRejectedError } from "./opencode-message-rejected-error";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessage, projectMessages } from "./opencode-message-projection";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";
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
  workflowPluginResponse,
  type NativeRequest,
} from "./opencode-v2.test-support";

const prepareFixture = (
  override?: (request: NativeRequest) => Response | Promise<Response> | undefined,
  resolveMcpServerConfig: ManagedMcpServerResolver = async () => ({
    command: ["odt-mcp"],
    environment: { OPENDUCKTOR_WORKSPACE_ID: "workspace-1" },
  }),
) => {
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
    if (url.pathname === "/api/rpc/openducktor-workflow-instructions/bind")
      return workflowPluginResponse();
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

const durable = { aggregateID: ref.externalSessionId, seq: 1, version: 1 as const };
const sessionCreated = (detail: SessionInfo): Extract<V2Event, { type: "session.created" }> => {
  const event: Extract<V2Event, { type: "session.created" }> = {
    id: `created_${detail.id}`,
    created: detail.time.created,
    type: "session.created",
    durable: { aggregateID: detail.id, seq: 1, version: 1 },
    data: {
      sessionID: detail.id,
      projectID: detail.projectID,
      location: detail.location,
      slug: detail.id,
      version: "2.0.24",
    },
  };
  if (detail.parentID) event.data.parentID = detail.parentID;
  return event;
};
const backgroundLaunch = (): SessionMessageInfo => ({
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
describe("OpenCode V2 live observation", () => {
  test("forwards global command and directory skill updates without admitted conversations", async () => {
    const fixture = prepareFixture();
    const runtime = await fixture.prepare();
    const signals: OpencodeSessionRuntimeSignal[] = [];
    const observed = Promise.withResolvers<void>();
    try {
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (signal.type === "runtime_notice") observed.resolve();
      });
      fixture.channel.push({ id: "evt_commands", type: "command.updated", data: {} });
      fixture.channel.push({
        id: "evt_skills",
        type: "skill.updated",
        location: { directory: ref.workingDirectory },
        data: {},
      });
      fixture.channel.push({
        id: "evt_observed",
        type: "tui.toast.show",
        data: { message: "Updates observed", variant: "warning" },
      });
      await observed.promise;
      expect(signals.filter((signal) => signal.type === "catalog_invalidated")).toEqual([
        { type: "catalog_invalidated" },
        { type: "catalog_invalidated", workingDirectory: ref.workingDirectory },
      ]);
    } finally {
      await runtime.release();
    }
  });

  test("admits a command child with the stored parent workflow prompt", async () => {
    const inheritedPrompt = "Saved custom Planner instructions.";
    const entries = new Map<string, string>([[ref.externalSessionId, inheritedPrompt]]);
    const fixture = prepareFixture(({ url, method, body }) => {
      if (method === "GET" && url.pathname === "/api/session/ses_child")
        return response(session({ id: "ses_child", parentID: ref.externalSessionId }));
      const instruction = url.pathname.match(
        /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries(?:\/openducktor.workflow)?$/,
      );
      if (instruction) {
        const id = instruction[1]!;
        if (method === "PUT") {
          entries.set(id, z.string().parse(body.value));
          return noContent();
        }
        const prompt = entries.get(id);
        return response(
          prompt === undefined ? [] : [{ key: "openducktor.workflow", value: prompt }],
        );
      }
      return undefined;
    });
    const runtime = await fixture.prepare();
    const admitted =
      Promise.withResolvers<Extract<OpencodeSessionRuntimeSignal, { type: "session_source" }>>();
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        {
          ...ref,
          sessionScope: { kind: "workflow", taskId: "task-1", role: "planner" },
        },
      ]);
      await runtime.startForwarding((signal) => {
        if (signal.type === "session_source" && signal.source.externalSessionId === "ses_child")
          admitted.resolve(signal);
        if (signal.type === "fault" || signal.type === "session_fault")
          admitted.reject(new Error(signal.message));
      });
      fixture.channel.push({
        id: "evt_command_child",
        type: "session.created",
        created: 5,
        durable: { aggregateID: "ses_child", seq: 1, version: 1 },
        data: {
          sessionID: "ses_child",
          projectID: "project-1",
          location: { directory: ref.workingDirectory },
          parentID: ref.externalSessionId,
          slug: "child",
          version: "2.0.24",
        },
      });
      const { source } = await admitted.promise;
      expect(entries.get("ses_child")).toBe(inheritedPrompt);
      expect(source).toMatchObject({
        parentExternalSessionId: ref.externalSessionId,
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
      });
    } finally {
      await runtime.release();
    }
  });
  for (const setupFailure of [
    {
      name: "the workflow plugin is unavailable",
      response: ({ url }: NativeRequest) =>
        url.pathname === "/api/rpc/openducktor-workflow-instructions/bind"
          ? Response.json({ output: { ready: false } })
          : undefined,
      expected: {
        code: "policy_failed",
        operation: "establish child workflow controls",
        externalSessionId: "ses_child",
        nextAction:
          "Restart the selected OpenCode runtime from Diagnostics, then retry the workflow action.",
      },
    },
    {
      name: "the parent instruction read returns an HTTP error",
      response: ({ url, method }: NativeRequest) =>
        method === "GET" &&
        url.pathname === "/api/experimental/session/ses_saved/instructions/entries"
          ? Response.json({ message: "Instruction read failed." }, { status: 500 })
          : undefined,
      expected: {
        code: "request_failed",
        operation: "read parent workflow instructions",
        externalSessionId: ref.externalSessionId,
        nextAction:
          "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
      },
    },
    {
      name: "the parent instruction read returns malformed JSON",
      response: ({ url, method }: NativeRequest) =>
        method === "GET" &&
        url.pathname === "/api/experimental/session/ses_saved/instructions/entries"
          ? new Response("{malformed", { headers: { "content-type": "application/json" } })
          : undefined,
      expected: {
        code: "invalid_runtime_response",
        operation: "read parent workflow instructions",
        externalSessionId: ref.externalSessionId,
        nextAction:
          "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
      },
    },
    {
      name: "the child instruction write returns an HTTP error",
      response: ({ url, method }: NativeRequest) =>
        method === "PUT" &&
        url.pathname ===
          "/api/experimental/session/ses_child/instructions/entries/openducktor.workflow"
          ? Response.json({ message: "Instruction write failed." }, { status: 500 })
          : undefined,
      expected: {
        code: "request_failed",
        operation: "install child session controls",
        externalSessionId: "ses_child",
        nextAction:
          "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
      },
    },
    {
      name: "the child permission update returns an HTTP error",
      response: ({ url, method }: NativeRequest) =>
        method === "PATCH" && url.pathname === "/api/session/ses_child"
          ? Response.json({ message: "Permission update failed." }, { status: 500 })
          : undefined,
      expected: {
        code: "request_failed",
        operation: "install child session controls",
        externalSessionId: "ses_child",
        nextAction:
          "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
      },
    },
  ]) {
    test(`keeps other workspaces observable and controllable after ${setupFailure.name}`, async () => {
      const other = {
        ...ref,
        repoPath: "/other",
        workingDirectory: "/other",
        externalSessionId: "ses_other",
      };
      let attachingChild = false;
      const fixture = prepareFixture((request) => {
        const failure = attachingChild ? setupFailure.response(request) : undefined;
        if (failure) return failure;
        const { url, method } = request;
        if (method === "GET" && url.pathname === "/api/session/ses_child")
          return response(session({ id: "ses_child", parentID: ref.externalSessionId }));
        if (method === "GET" && url.pathname === "/api/session/ses_other")
          return response(
            session({ id: other.externalSessionId, location: { directory: "/other" } }),
          );
        if (url.pathname.endsWith("/instructions/entries"))
          return response(
            url.pathname.includes("ses_saved")
              ? [{ key: "openducktor.workflow", value: "Planner instructions." }]
              : [],
          );
        if (
          method === "PUT" &&
          url.pathname ===
            "/api/experimental/session/ses_child/instructions/entries/openducktor.workflow"
        )
          return noContent();
        if (
          url.pathname === "/api/location" &&
          url.searchParams.get("location[directory]") === "/other"
        )
          return Response.json({
            ...location,
            directory: "/other",
            project: { ...location.project, directory: "/other" },
          });
        return undefined;
      });
      const runtime = await fixture.prepare();
      const signals: OpencodeSessionRuntimeSignal[] = [];
      const failed = Promise.withResolvers<OpencodeSessionRuntimeSignal>();
      const observed = Promise.withResolvers<void>();
      try {
        await runtime.connection.readSessionSources(ref.repoPath, [
          { ...ref, sessionScope: { kind: "workflow", taskId: "task-1", role: "planner" } },
        ]);
        await runtime.connection.readSessionSources(other.repoPath, [
          { ...other, sessionScope: { kind: "repository" } },
        ]);
        attachingChild = true;
        await runtime.startForwarding((signal) => {
          signals.push(signal);
          if (signal.type === "fault" || signal.type === "session_fault") failed.resolve(signal);
          if (
            signal.type === "session_event" &&
            signal.externalSessionId === other.externalSessionId
          )
            observed.resolve();
        });
        fixture.channel.push({
          id: "evt_child_created",
          type: "session.created",
          created: 5,
          durable: { aggregateID: "ses_child", seq: 1, version: 1 },
          data: {
            sessionID: "ses_child",
            projectID: "project-1",
            location: { directory: ref.workingDirectory },
            parentID: ref.externalSessionId,
            slug: "child",
            version: "2.0.24",
          },
        });
        expect(await failed.promise).toMatchObject({
          type: "session_fault",
          externalSessionId: ref.externalSessionId,
          runtimeOperationFailure: {
            runtimeKind: "opencode",
            repoPath: ref.repoPath,
            workingDirectory: ref.workingDirectory,
            ...setupFailure.expected,
          },
        });
        fixture.channel.push({
          id: "evt_other_started",
          type: "session.execution.started",
          created: 6,
          data: { sessionID: other.externalSessionId },
        });
        await observed.promise;
        const resumed = await runtime.connection.resumeSession({
          ...other,
          runtimePolicy: { kind: "opencode" },
          sessionScope: { kind: "repository" },
        });
        expect(resumed).toMatchObject({ externalSessionId: other.externalSessionId });
        expect(signals.some((signal) => signal.type === "fault")).toBe(false);
        expect(
          signals.some(
            (signal) =>
              signal.type === "session_source" && signal.source.externalSessionId === "ses_child",
          ),
        ).toBe(false);
      } finally {
        await runtime.release();
      }
    });
  }

  test("restores the stored workflow prompt and chronological instruction updates on reconnect", async () => {
    const fixture = prepareFixture(({ url }) => {
      if (url.pathname.endsWith("/instructions/entries"))
        return response([
          { key: "openducktor.workflow", value: "OpenDucktor Planner instructions." },
        ]);
      if (url.pathname.endsWith("/message"))
        return cursorPage([
          {
            id: "msg_update",
            type: "system",
            time: { created: 3 },
            text: "Native tools changed.",
            metadata: { notice: "instructions", instructionSources: ["core/codemode"] },
          },
        ]);
      return undefined;
    });
    const runtime = await fixture.prepare();
    const notices: OpencodeSessionRuntimeSignal[] = [];
    const restored = Promise.withResolvers<void>();
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "workflow", taskId: "task-1", role: "planner" } },
      ]);
      await runtime.startForwarding((signal) => {
        if (signal.type === "fault") restored.reject(new Error(signal.message));
        if (signal.type !== "session_event" || signal.event.type !== "session_policy_notice")
          return;
        notices.push(signal);
        if (signal.event.messageId === "msg_update") restored.resolve();
      });
      fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
      await restored.promise;
      expect(notices).toMatchObject([
        {
          provenance: "baseline",
          event: {
            messageId: `history:system-prompt:${ref.externalSessionId}`,
            message: "System prompt:\n\nOpenDucktor Planner instructions.",
          },
        },
        {
          provenance: "baseline",
          event: {
            messageId: "msg_update",
            message: "Instructions update:\n\nNative tools changed.",
          },
        },
      ]);
      expect(fixture.requests.every(({ method }) => method === "GET")).toBe(true);
    } finally {
      await runtime.release();
    }
  });

  test.each([
    ["validation", "idle"],
    ["prompt", "idle"],
    ["command", "idle"],
    ["validation", "running"],
    ["prompt", "running"],
  ] as const)(
    "settles preparation after a native %s rejection while %s",
    async (rejection, activity) => {
      let rejectRead = false;
      let sends = 0;
      const fixture = prepareFixture(({ url, method }) => {
        if (url.pathname === "/api/session/active")
          return response(
            activity === "running" ? { [ref.externalSessionId]: { type: "running" } } : {},
          );
        if (
          rejectRead &&
          (rejection === "validation"
            ? method === "GET" && url.pathname === "/api/session/ses_saved"
            : url.pathname.endsWith(`/${rejection}`))
        ) {
          rejectRead = false;
          return Response.json({ message: "Native validation failed" }, { status: 503 });
        }
        return undefined;
      });
      const runtime = await fixture.prepare();
      const input = {
        ...ref,
        runtimePolicy: { kind: "opencode" as const },
        sessionScope: { kind: "repository" as const },
      };
      const statuses: string[] = [];
      try {
        await expect(runtime.connection.resumeSession(input)).resolves.toMatchObject({
          status: activity === "running" ? "running" : "idle",
        });
        await runtime.startForwarding((signal) => {
          if (signal.type !== "session_event" || signal.event.type !== "session_status") return;
          statuses.push(signal.event.status.type);
        });
        rejectRead = true;
        await expect(
          runtime.connection.sendUserMessage(
            {
              ...input,
              parts:
                rejection === "command"
                  ? [
                      {
                        kind: "slash_command",
                        command: { name: "review", trigger: "review", source: "custom" },
                      },
                    ]
                  : [{ kind: "text", text: "Retain draft" }],
            },
            {
              onSent: () => {
                sends++;
              },
            },
          ),
        ).rejects.toThrow("UnexpectedStatus: 503");
        expect(statuses).toEqual(["busy", activity === "running" ? "busy" : "idle"]);
        expect(sends).toBe(rejection === "validation" ? 0 : 1);
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0]?.runtimeActivity,
        ).toBe(activity);
        expect(fixture.requests.some(({ url }) => /\/(prompt|command)$/.test(url.pathname))).toBe(
          rejection !== "validation",
        );
      } finally {
        await runtime.release();
      }
    },
  );

  test.each(["failed", "pending", "missing"] as const)(
    "allows native decisions, form replies, and compaction while the MCP bridge is %s",
    async (bridgeStatus) => {
      let bridgeFailed = false;
      const fixture = prepareFixture(({ url, method }) => {
        if (bridgeFailed && url.pathname === "/api/mcp")
          return Response.json({
            location: { directory: "/repo" },
            data:
              bridgeStatus === "missing"
                ? []
                : [
                    {
                      name: "openducktor",
                      status:
                        bridgeStatus === "failed"
                          ? { status: "failed", error: "Bridge unavailable" }
                          : { status: "pending" },
                    },
                  ],
          });
        if (
          method === "POST" &&
          /\/(permission\/permission_native\/reply|form\/form_native\/reply)$/.test(url.pathname)
        )
          return noContent();
        if (url.pathname.endsWith("/form/form_native"))
          return response({
            id: "form_native",
            sessionID: ref.externalSessionId,
            title: "Choose",
            fields: [{ key: "answer", type: "string", title: "Answer" }],
          });
        if (url.pathname.endsWith("/compact"))
          return response({
            id: "msg_compact",
            sessionID: ref.externalSessionId,
            type: "compaction",
            payload: {},
            delivery: "prompt",
            time: { created: 10 },
          });
        return undefined;
      });
      const runtime = await fixture.prepare();
      try {
        await runtime.connection.resumeSession({
          ...ref,
          runtimePolicy: { kind: "opencode" },
          sessionScope: { kind: "repository" },
        });
        bridgeFailed = true;
        fixture.requests.length = 0;
        for (const outcome of ["approve_once", "approve_always", "reject"] as const)
          await runtime.connection.replyApproval({
            ref,
            nativeRequestId: "permission_native",
            outcome,
          });
        await runtime.connection.replyQuestion({
          ref,
          nativeRequestId: "form_native",
          answers: [["Keep this answer"]],
        });
        await expect(
          runtime.connection.sendUserMessage({
            ...ref,
            runtimePolicy: { kind: "opencode" },
            sessionScope: { kind: "repository" },
            parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
          }),
        ).resolves.toEqual({
          type: "command_accepted",
          commandName: "compact",
          inputId: "msg_compact",
        });
        expect(
          fixture.requests.filter(({ method }) => method === "POST").map(({ body }) => body),
        ).toEqual([
          { decision: "once" },
          { decision: "always" },
          { decision: "reject" },
          { answer: { answer: "Keep this answer" } },
          {},
        ]);
        expect(fixture.requests.some(({ url }) => url.pathname === "/api/mcp")).toBe(false);
      } finally {
        await runtime.release();
      }
    },
  );

  test.each([
    {
      stage: "migration",
      page: null,
      responseType: "HTTP",
      code: "request_failed",
      reason: "UnexpectedStatus: 503",
    },
    {
      stage: "migration",
      page: null,
      responseType: "malformed JSON",
      code: "invalid_runtime_response",
      reason: "MalformedResponse",
    },
    {
      stage: "migration",
      page: null,
      responseType: "invalid status",
      code: "invalid_runtime_response",
      reason: "status",
    },
    {
      stage: "page 1",
      page: 1,
      responseType: "HTTP",
      code: "request_failed",
      reason: "UnexpectedStatus: 503",
    },
    {
      stage: "page 1",
      page: 1,
      responseType: "malformed JSON",
      code: "invalid_runtime_response",
      reason: "MalformedResponse",
    },
    {
      stage: "page 2",
      page: 2,
      responseType: "HTTP",
      code: "request_failed",
      reason: "UnexpectedStatus: 503",
    },
    {
      stage: "page 2",
      page: 2,
      responseType: "malformed JSON",
      code: "invalid_runtime_response",
      reason: "MalformedResponse",
    },
  ])(
    "maps $responseType import failures at $stage",
    async ({ page, responseType, code, reason }) => {
      const cursors: (string | null)[] = [];
      const fixture = prepareFixture(({ url }) => {
        if (page === null) {
          if (!url.pathname.endsWith("/migration/v1")) return undefined;
        } else {
          if (url.pathname !== "/api/session") return undefined;
          cursors.push(url.searchParams.get("cursor"));
          if (cursors.length < page)
            return Response.json({ data: [session()], cursor: { next: "next_page", prev: null } });
        }
        if (responseType === "invalid status") return Response.json({ status: "unknown" });
        return responseType === "HTTP"
          ? Response.json({ message: "Native import failed" }, { status: 503 })
          : new Response("{not-json", { headers: { "content-type": "application/json" } });
      });
      const runtime = await fixture.prepare();
      try {
        const iterator = runtime.sessionImport
          .scanSessions({
            repoPath: ref.repoPath,
            signal: new AbortController().signal,
          })
          [Symbol.asyncIterator]();
        if (page === 2)
          expect(await iterator.next()).toEqual({
            done: false,
            value: [
              {
                externalSessionId: ref.externalSessionId,
                runtimeKind: "opencode",
                workingDirectory: ref.workingDirectory,
                title: null,
                updatedAt: 2,
              },
            ],
          });
        const failure = await iterator.next().catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(OpenCodeOperationError);
        if (!(failure instanceof OpenCodeOperationError))
          throw new Error("Expected import failure");
        expect(failure.failure).toMatchObject({
          kind: "runtime_operation",
          runtimeOperationFailure: {
            runtimeKind: "opencode",
            repoPath: ref.repoPath,
            operation: "list native conversations",
            code,
            nativeReason: expect.stringContaining(reason),
            nextAction:
              "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
          },
        });
        expect(cursors).toEqual(page === null ? [] : page === 1 ? [null] : [null, "next_page"]);
        if (page === null)
          expect(fixture.requests.filter(({ url }) => url.pathname === "/api/session")).toEqual([]);
      } finally {
        await runtime.release();
      }
    },
  );

  test.each([
    {
      label: "session metadata HTTP failure",
      path: "/session/ses_saved",
      operation: "restore the linked conversation",
      code: "request_failed",
      reason: "503",
    },
    {
      label: "snapshot HTTP failure",
      path: "/permission",
      operation: "read the conversation",
      code: "request_failed",
      reason: "503",
    },
    {
      label: "malformed JSON",
      path: "/form",
      operation: "read the conversation",
      code: "invalid_runtime_response",
      reason: "MalformedResponse",
      reply: () => new Response("{not-json", { headers: { "content-type": "application/json" } }),
    },
    {
      label: "malformed snapshot data",
      path: "/form",
      operation: "read the conversation",
      code: "request_failed",
      reason: "map",
      reply: () => response({ invalid: true }),
    },
    {
      label: "child list HTTP failure",
      path: "/api/session",
      operation: "list child conversations",
      code: "request_failed",
      reason: "503",
    },
  ])(
    "reports structured restore failures and unavailable reconnect status for $label",
    async ({ path, operation, code, reason, reply }) => {
      let reconnect = false;
      const fixture = prepareFixture(({ url }) =>
        reconnect && url.pathname.endsWith(path)
          ? (reply?.() ?? Response.json({ message: "Native restore failed" }, { status: 503 }))
          : undefined,
      );
      const runtime = await fixture.prepare();
      const failed = Promise.withResolvers<OpencodeSessionRuntimeSignal>();
      const roots = [{ ...ref, sessionScope: { kind: "repository" as const } }];
      try {
        const initial = await runtime.connection.readSessionSources(ref.repoPath, roots);
        expect(initial.failures).toEqual([]);
        await runtime.startForwarding((signal) => {
          if (signal.type === "session_fault" || signal.type === "fault") failed.resolve(signal);
        });
        reconnect = true;
        const restored = await runtime.connection.readSessionSources(ref.repoPath, roots);
        expect(restored.failures).toMatchObject([
          {
            repoPath: ref.repoPath,
            workingDirectory: ref.workingDirectory,
            externalSessionId: ref.externalSessionId,
            runtimeOperationFailure: {
              ...ref,
              runtimeKind: "opencode",
              operation,
              code,
              nativeReason: expect.stringContaining(reason),
              nextAction: expect.stringContaining("retry"),
            },
          },
        ]);
        fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
        expect(await failed.promise).toMatchObject({
          type: "session_fault",
          externalSessionId: ref.externalSessionId,
          statusUnavailable: true,
          runtimeOperationFailure: restored.failures[0]!.runtimeOperationFailure,
        });
      } finally {
        await runtime.release();
      }
    },
  );

  test.each([
    {
      submission: "prompt",
      type: "session.execution.succeeded",
      data: { sessionID: ref.externalSessionId },
    },
    {
      submission: "prompt",
      type: "session.execution.failed",
      data: { sessionID: ref.externalSessionId, error: { message: "Provider failed" } },
    },
    {
      submission: "prompt",
      type: "session.execution.interrupted",
      data: { sessionID: ref.externalSessionId, reason: "user" },
    },
    {
      submission: "compact",
      type: "session.execution.succeeded",
      data: { sessionID: ref.externalSessionId },
    },
    {
      submission: "prompt",
      type: "stopSession",
      data: { sessionID: ref.externalSessionId },
    },
  ] as const)(
    "keeps $submission active across cold reads and reconnect until $type",
    async ({ submission, ...terminal }) => {
      const submitted = Promise.withResolvers<void>();
      const accepted = Promise.withResolvers<Response>();
      let queued = false;
      const fixture = prepareFixture(({ url }) => {
        if (queued && url.pathname.endsWith("/inbox"))
          return response([
            {
              id: "msg_kickoff",
              sessionID: ref.externalSessionId,
              type: submission === "compact" ? "compaction" : "user",
              payload: submission === "compact" ? {} : { text: "Verify startup" },
              delivery: "prompt",
              time: { created: 10 },
            },
          ]);
        if (url.pathname.endsWith("/interrupt")) return response({ interrupted: false });
        if (!url.pathname.endsWith(`/${submission}`)) return undefined;
        submitted.resolve();
        return accepted.promise;
      });
      const runtime = await fixture.prepare();
      const sessionInput = {
        ...ref,
        runtimePolicy: { kind: "opencode" as const },
        sessionScope: { kind: "repository" as const },
      };
      const started = Promise.withResolvers<void>();
      const completed = Promise.withResolvers<void>();
      const restored = Promise.withResolvers<OpencodeSessionRuntimeSignal>();
      const statuses: string[] = [];
      let sending: ReturnType<typeof runtime.connection.sendUserMessage> | undefined;
      try {
        await runtime.connection.resumeSession(sessionInput);
        await runtime.startForwarding((signal) => {
          if (signal.type === "session_source") restored.resolve(signal);
          if (signal.type !== "session_event") return;
          if (signal.event.type === "session_status") {
            statuses.push(signal.event.status.type);
            if (signal.event.timestamp === new Date(20).toISOString()) started.resolve();
            if (signal.event.status.type === "idle") completed.resolve();
          }
          if (signal.event.type === "session_idle") {
            statuses.push("idle");
            if (signal.event.timestamp === new Date(30).toISOString()) completed.resolve();
          }
        });
        sending = runtime.connection.sendUserMessage({
          ...sessionInput,
          parts:
            submission === "compact"
              ? [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }]
              : [{ kind: "text", text: "Verify startup" }],
        });
        await submitted.promise;
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0]?.runtimeActivity,
        ).toBe("running");
        queued = true;
        accepted.resolve(
          response({
            id: "msg_kickoff",
            sessionID: ref.externalSessionId,
            type: submission === "compact" ? "compaction" : "user",
            payload: submission === "compact" ? {} : { text: "Verify startup" },
            delivery: "prompt",
            time: { created: 10 },
          }),
        );
        await expect(sending).resolves.toMatchObject(
          submission === "compact"
            ? { type: "command_accepted", commandName: "compact" }
            : { messageId: "msg_kickoff", state: "queued" },
        );
        await expect(runtime.connection.resumeSession(sessionInput)).resolves.toMatchObject({
          status: "running",
        });
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0]?.runtimeActivity,
        ).toBe("running");
        fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
        expect(await restored.promise).toMatchObject({
          type: "session_source",
          source: { externalSessionId: ref.externalSessionId, runtimeActivity: "running" },
        });
        fixture.channel.push({
          id: "evt_old_idle",
          type: "session.idle",
          created: 19,
          data: { sessionID: ref.externalSessionId },
        });
        if (terminal.type !== "stopSession") {
          fixture.channel.push({
            id: "evt_started",
            type: "session.execution.started",
            created: 20,
            data: { sessionID: ref.externalSessionId },
          });
          await started.promise;
        } else {
          await runtime.connection.readSessionSources(ref.repoPath);
        }
        expect(statuses).not.toContain("idle");
        if (terminal.type === "stopSession") {
          await runtime.connection.stopSession(sessionInput);
        } else {
          queued = false;
          fixture.channel.push({
            id: "evt_delivered",
            type: "session.inbox.delivered",
            created: 25,
            durable,
            data: { sessionID: ref.externalSessionId, inboxID: "msg_kickoff" },
          });
          fixture.channel.push({
            ...terminal,
            id: "evt_completed",
            created: 30,
            durable: { ...durable, seq: 2 },
          });
        }
        await completed.promise;
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0]?.runtimeActivity,
        ).toBe("idle");
        expect(statuses.at(-1)).toBe("idle");
      } finally {
        accepted.resolve(Response.json({ message: "Cancelled verification" }, { status: 503 }));
        await Promise.allSettled([sending]);
        await runtime.release();
      }
    },
  );

  test.each([
    "native execution",
    "input preparation",
    "execution during command preparation",
    "idle",
    "another conversation running",
  ] as const)("submits custom commands only while idle, with %s", async (activity) => {
    const readStarted = Promise.withResolvers<void>();
    const read = Promise.withResolvers<Response>();
    const observed = Promise.withResolvers<void>();
    let deferRead = false;
    const fixture = prepareFixture(({ url, method }) => {
      if (url.pathname === "/api/session/active")
        return response(
          activity === "native execution"
            ? { [ref.externalSessionId]: true }
            : activity === "another conversation running"
              ? { ses_other: true }
              : {},
        );
      if (deferRead && method === "GET" && url.pathname === "/api/session/ses_saved") {
        deferRead = false;
        readStarted.resolve();
        return read.promise;
      }
      if (url.pathname.endsWith("/prompt"))
        return response({
          id: "msg_prepared",
          sessionID: ref.externalSessionId,
          type: "user",
          payload: { text: "Prepare input" },
          delivery: "queue",
          time: { created: 10 },
        });
      if (url.pathname.endsWith("/command")) return noContent();
      return undefined;
    });
    const runtime = await fixture.prepare();
    const sessionInput = {
      ...ref,
      runtimePolicy: { kind: "opencode" as const },
      sessionScope: { kind: "repository" as const },
    };
    const statuses: string[] = [];
    let preparing: ReturnType<typeof runtime.connection.sendUserMessage> | undefined;
    let sent = false;
    try {
      await runtime.connection.resumeSession(sessionInput);
      await runtime.startForwarding((signal) => {
        if (signal.type === "runtime_notice") observed.resolve();
        if (signal.type === "session_event" && signal.event.type === "session_status")
          statuses.push(signal.event.status.type);
      });
      if (activity === "input preparation") {
        deferRead = true;
        preparing = runtime.connection.sendUserMessage({
          ...sessionInput,
          parts: [{ kind: "text", text: "Prepare input" }],
        });
        await readStarted.promise;
      }
      if (activity === "execution during command preparation") deferRead = true;
      const sending = runtime.connection
        .sendUserMessage(
          {
            ...sessionInput,
            parts: [
              {
                kind: "slash_command",
                command: { id: "review", trigger: "review", title: "Review", hints: [] },
              },
            ],
          },
          { onSent: () => (sent = true) },
        )
        .catch((cause: unknown) => cause);
      if (activity === "execution during command preparation") {
        await readStarted.promise;
        fixture.channel.push({
          id: "evt_started",
          type: "session.execution.started",
          created: 20,
          durable,
          data: { sessionID: ref.externalSessionId },
        });
        fixture.channel.push({
          id: "evt_execution_observed",
          type: "tui.toast.show",
          data: { message: "Execution observed", variant: "warning" },
        });
        await observed.promise;
      }
      read.resolve(response(session()));
      await preparing;
      const result = await sending;
      if (activity === "idle" || activity === "another conversation running") {
        expect(result).toEqual({ type: "command_accepted", commandName: "review" });
        expect(sent).toBe(true);
        expect(
          fixture.requests.filter(({ url }) => url.pathname.endsWith("/command")),
        ).toHaveLength(1);
      } else {
        expect(result).toBeInstanceOf(OpenCodeMessageRejectedError);
        if (!(result instanceof OpenCodeMessageRejectedError))
          throw new Error("Expected rejection");
        expect(result.failure?.runtimeOperationFailure).toMatchObject({
          ...ref,
          code: "unsupported_operation",
          nextAction: expect.stringContaining("idle"),
        });
        expect(sent).toBe(false);
        expect(fixture.requests.some(({ url }) => url.pathname.endsWith("/command"))).toBe(false);
      }
      expect(statuses).not.toContain("idle");
    } finally {
      read.resolve(response(session()));
      await Promise.allSettled([preparing]);
      await runtime.release();
    }
  });

  test.each(
    (["prompt", "compact"] as const).flatMap((submission) =>
      (
        [
          { type: "session.execution.succeeded", stop: false },
          { type: "session.execution.failed", stop: false },
          { type: "session.execution.succeeded", stop: true },
        ] as const
      ).map((terminal) => ({ ...terminal, submission })),
    ),
  )(
    "keeps queued $submission follow-ups active after prior $type until consumed or stopped (stop=$stop)",
    async ({ type, stop, submission }) => {
      let active = true;
      const inbox: SessionInboxInfo[] = [];
      const fixture = prepareFixture(({ url }) => {
        if (url.pathname === "/api/session/active")
          return response(active ? { [ref.externalSessionId]: true } : {});
        if (url.pathname.endsWith("/inbox")) return response(inbox);
        if (url.pathname.endsWith("/interrupt")) return response({ interrupted: false });
        if (!url.pathname.endsWith(`/${submission}`)) return undefined;
        const item: SessionInboxInfo = {
          id: `msg_followup_${inbox.length + 1}`,
          sessionID: ref.externalSessionId,
          ...(submission === "compact"
            ? { type: "compaction", payload: {} }
            : { type: "user", payload: { text: "Queued follow-up" } }),
          delivery: "queue",
          time: { created: 20 },
        };
        inbox.push(item);
        return response(item);
      });
      const runtime = await fixture.prepare();
      const sessionInput = {
        ...ref,
        runtimePolicy: { kind: "opencode" as const },
        sessionScope: { kind: "repository" as const },
      };
      const statuses: string[] = [];
      const barriers = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
      const restored = Promise.withResolvers<OpencodeSessionRuntimeSignal>();
      let seq = 0;
      const observe = async (event: V2Event) => {
        const barrierID = `evt_barrier_${seq}`;
        const barrier = Promise.withResolvers<void>();
        barriers.set(barrierID.replace(/^evt_/, "msg_"), barrier);
        fixture.channel.push(event);
        fixture.channel.push({
          id: barrierID,
          type: "session.synthetic",
          created: 40 + seq,
          durable: { ...durable, seq: ++seq },
          data: { sessionID: ref.externalSessionId, text: "Observation barrier" },
        });
        await barrier.promise;
      };
      try {
        await runtime.connection.resumeSession(sessionInput);
        await runtime.startForwarding((signal) => {
          if (signal.type === "session_source") restored.resolve(signal);
          if (signal.type !== "session_event") return;
          if (signal.event.type === "session_policy_notice")
            barriers.get(signal.event.messageId!)?.resolve();
          if (signal.event.type === "session_status") statuses.push(signal.event.status.type);
          if (signal.event.type === "session_idle") statuses.push("idle");
        });
        for (let index = 0; index < 2; index++)
          await runtime.connection.sendUserMessage({
            ...sessionInput,
            parts:
              submission === "compact"
                ? [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }]
                : [{ kind: "text", text: "Queued follow-up" }],
          });
        active = false;
        await observe({
          id: "evt_prior_terminal",
          type,
          created: 30,
          durable: { ...durable, seq: ++seq },
          data:
            type === "session.execution.failed"
              ? { sessionID: ref.externalSessionId, error: { message: "Prior turn failed" } }
              : { sessionID: ref.externalSessionId },
        });
        expect(statuses).not.toContain("idle");
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0],
        ).toMatchObject({
          runtimeActivity: "running",
          queuedMessages:
            submission === "compact"
              ? []
              : [{ messageId: "msg_followup_1" }, { messageId: "msg_followup_2" }],
        });
        expect(await runtime.connection.resumeSession(sessionInput)).toMatchObject({
          status: "running",
        });
        fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
        expect(await restored.promise).toMatchObject({
          type: "session_source",
          source: { runtimeActivity: "running" },
        });
        if (stop) {
          await runtime.connection.stopSession(sessionInput);
          expect(
            (await runtime.connection.readSessionSources(ref.repoPath)).sources[0],
          ).toMatchObject({
            runtimeActivity: "idle",
            queuedMessages:
              submission === "compact"
                ? []
                : [{ messageId: "msg_followup_1" }, { messageId: "msg_followup_2" }],
          });
          expect(statuses.at(-1)).toBe("idle");
          return;
        }
        active = true;
        await observe({
          id: "evt_followup_started",
          type: "session.execution.started",
          created: 50,
          durable: { ...durable, seq: ++seq },
          data: { sessionID: ref.externalSessionId },
        });
        inbox.shift();
        await observe({
          id: "evt_first_delivered",
          type: "session.inbox.delivered",
          created: 60,
          durable: { ...durable, seq: ++seq },
          data: { sessionID: ref.externalSessionId, inboxID: "msg_followup_1" },
        });
        active = false;
        await observe({
          id: "evt_followup_terminal",
          type: "session.execution.succeeded",
          created: 70,
          durable: { ...durable, seq: ++seq },
          data: { sessionID: ref.externalSessionId },
        });
        expect(statuses).not.toContain("idle");
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0],
        ).toMatchObject({
          runtimeActivity: "running",
          queuedMessages: submission === "compact" ? [] : [{ messageId: "msg_followup_2" }],
        });
        inbox.length = 0;
        await observe({
          id: "evt_second_cancelled",
          type: "session.inbox.cancelled",
          created: 80,
          durable: { ...durable, seq: ++seq },
          data: { sessionID: ref.externalSessionId, inboxID: "msg_followup_2" },
        });
        expect(statuses.at(-1)).toBe("idle");
        expect(
          (await runtime.connection.readSessionSources(ref.repoPath)).sources[0],
        ).toMatchObject({
          runtimeActivity: "idle",
          queuedMessages: [],
        });
      } finally {
        await runtime.release();
      }
    },
  );

  test.each(
    (["prompt", "compact"] as const).flatMap((submission) =>
      (["session.inbox.delivered", "session.inbox.cancelled"] as const).map((type) => ({
        submission,
        type,
      })),
    ),
  )("settles $type observed before the $submission receipt", async ({ type, submission }) => {
    const submitted = Promise.withResolvers<void>();
    const accepted = Promise.withResolvers<Response>();
    const consumed = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const receiptObserved = Promise.withResolvers<void>();
    const statuses: string[] = [];
    let active = type === "session.inbox.delivered";
    let delivered = false;
    const fixture = prepareFixture(({ url }) => {
      if (url.pathname === "/api/session/active")
        return response(active ? { [ref.externalSessionId]: true } : {});
      if (delivered && submission === "prompt" && url.pathname.endsWith("/message"))
        return cursorPage([
          {
            id: "msg_followup",
            type: "user",
            text: "Verify receipt ordering",
            time: { created: 20 },
          },
        ]);
      if (!url.pathname.endsWith(`/${submission}`)) return undefined;
      submitted.resolve();
      return accepted.promise;
    });
    const runtime = await fixture.prepare();
    const sessionInput = {
      ...ref,
      runtimePolicy: { kind: "opencode" as const },
      sessionScope: { kind: "repository" as const },
    };
    let sending: ReturnType<typeof runtime.connection.sendUserMessage> | undefined;
    try {
      await runtime.connection.resumeSession(sessionInput);
      await runtime.startForwarding((signal) => {
        if (signal.type === "runtime_notice") {
          if (signal.message === "Input consumed") consumed.resolve();
          if (signal.message === "Receipt observed") receiptObserved.resolve();
        }
        if (signal.type !== "session_event") return;
        if (signal.event.type === "session_status") statuses.push(signal.event.status.type);
        if (signal.event.type === "session_idle") statuses.push("idle");
        if (signal.event.type === "session_status" && signal.event.status.type === "idle")
          completed.resolve();
        if (signal.event.type === "session_idle") completed.resolve();
      });
      sending = runtime.connection.sendUserMessage({
        ...sessionInput,
        parts:
          submission === "compact"
            ? [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }]
            : [{ kind: "text", text: "Verify receipt ordering" }],
      });
      await submitted.promise;
      fixture.channel.push({
        id: "evt_enqueued",
        type: "session.inbox.enqueued",
        created: 10,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          inboxID: "msg_followup",
          item:
            submission === "compact"
              ? { type: "compaction", payload: {}, delivery: "queue" }
              : {
                  type: "user",
                  payload: { text: "Verify receipt ordering" },
                  delivery: "queue",
                },
        },
      });
      fixture.channel.push({
        id: "evt_consumed",
        type,
        created: 20,
        durable: { ...durable, seq: 2 },
        data: { sessionID: ref.externalSessionId, inboxID: "msg_followup" },
      });
      fixture.channel.push({
        id: "evt_idle_before_receipt",
        type: "session.idle",
        created: 21,
        data: { sessionID: ref.externalSessionId },
      });
      fixture.channel.push({
        id: "evt_consumption_observed",
        type: "tui.toast.show",
        data: { message: "Input consumed", variant: "warning" },
      });
      await consumed.promise;
      active = false;
      delivered = type === "session.inbox.delivered";
      accepted.resolve(
        response({
          id: "msg_followup",
          sessionID: ref.externalSessionId,
          type: submission === "compact" ? "compaction" : "user",
          payload: submission === "compact" ? {} : { text: "Verify receipt ordering" },
          delivery: "queue",
          time: { created: 10 },
        }),
      );
      await sending;
      fixture.channel.push({
        id: "evt_receipt_observed",
        type: "tui.toast.show",
        data: { message: "Receipt observed", variant: "warning" },
      });
      await receiptObserved.promise;
      expect(statuses.at(-1)).toBe("idle");
      expect((await runtime.connection.readSessionSources(ref.repoPath)).sources[0]).toMatchObject({
        runtimeActivity: "idle",
        queuedMessages: [],
      });
      if (delivered)
        fixture.channel.push({
          id: "evt_completed",
          type: "session.execution.succeeded",
          created: 30,
          durable: { ...durable, seq: 3 },
          data: { sessionID: ref.externalSessionId },
        });
      await completed.promise;
    } finally {
      accepted.resolve(Response.json({ message: "Cancelled verification" }, { status: 503 }));
      await Promise.allSettled([sending]);
      await runtime.release();
    }
  });

  test.each([
    { label: "blocked native migration", migrationStatus: "required", code: "migration_blocked" },
    { label: "failed native read", migrationStatus: "completed", code: "request_failed" },
  ])("publishes a valid scoped-session fault for $label", async ({ migrationStatus, code }) => {
    const fixture = prepareFixture(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: migrationStatus });
      if (method === "GET" && url.pathname === "/api/session/ses_saved")
        return Response.json({ message: "Native session read failed" }, { status: 503 });
      return undefined;
    });
    const runtime = await fixture.prepare();
    try {
      const read = await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" } },
      ]);
      expect(read.sources).toEqual([]);
      expect(read.failures).toHaveLength(1);
      const failure = read.failures[0]!;
      const envelope = hostEventEnvelopeSchema.parse({
        channel: "openducktor://agent-session-live-event",
        payload: {
          type: "fault",
          repoPath: failure.repoPath,
          ref: { ...ref, runtimeKind: "opencode" },
          operation: "opencode-live-session.refresh-session",
          message: failure.message,
          statusUnavailable: true,
          runtimeOperationFailure: failure.runtimeOperationFailure,
        },
      });
      expect(envelope).toMatchObject({
        payload: {
          runtimeOperationFailure: {
            code,
            runtimeKind: "opencode",
            repoPath: ref.repoPath,
            workingDirectory: ref.workingDirectory,
            externalSessionId: ref.externalSessionId,
            nativeReason: expect.any(String),
            nextAction: expect.any(String),
          },
        },
      });
      expect(fixture.requests.every(({ method }) => method === "GET")).toBe(true);
    } finally {
      await runtime.release();
    }
  });

  test.each(["spec", "planner", "build", "qa"] as const)(
    "restores migrated %s conversations without instructions and requires them before resume",
    async (role) => {
      const fixture = prepareFixture(({ url, method }) => {
        if (url.pathname === "/api/session" && url.searchParams.get("parentID") === "ses_saved")
          return cursorPage([session({ id: "ses_child", parentID: "ses_saved" })]);
        if (url.pathname === "/api/session/ses_child")
          return response(session({ id: "ses_child", parentID: "ses_saved" }));
        if (url.pathname.endsWith("/instructions/entries")) return response([]);
        if (method === "PUT" && url.pathname.endsWith("/instructions/entries/openducktor.workflow"))
          return noContent();
        return undefined;
      });
      const runtime = await fixture.prepare();
      const sessionScope = { kind: "workflow" as const, taskId: "task-1", role };
      const input = { ...ref, runtimePolicy: { kind: "opencode" as const }, sessionScope };
      try {
        const read = await runtime.connection.readSessionSources(ref.repoPath, [input]);
        expect(read.failures).toEqual([]);
        expect(read.sources).toMatchObject([
          { externalSessionId: "ses_saved", sessionAssociation: sessionScope },
          {
            externalSessionId: "ses_child",
            parentExternalSessionId: "ses_saved",
            sessionAssociation: sessionScope,
          },
        ]);
        expect(fixture.requests.every(({ method }) => method === "GET")).toBe(true);
        await expect(runtime.connection.resumeSession(input)).rejects.toThrow(
          "no confirmed OpenDucktor workflow instructions",
        );
        const systemPrompt = `Resolved ${role} workflow instructions for task-1.`;
        await expect(
          runtime.connection.resumeSession({ ...input, systemPrompt }),
        ).resolves.toMatchObject({
          externalSessionId: "ses_saved",
          sessionAssociation: sessionScope,
        });
        expect(
          fixture.requests.find(({ url }) =>
            url.pathname.endsWith("/instructions/entries/openducktor.workflow"),
          )?.body,
        ).toEqual({ value: systemPrompt });
        expect(fixture.requests.some(({ url }) => /\/(prompt|command)$/.test(url.pathname))).toBe(
          false,
        );
      } finally {
        await runtime.release();
      }
    },
  );

  test.each(["ended", "failed"] as const)(
    "restores paged context usage and updates it through native %s steps, reversion, and compaction",
    async (ending) => {
      const tokens = { input: 1000, output: 100, reasoning: 20, cache: { read: 2000, write: 50 } };
      const latest: SessionMessageInfo = {
        id: "msg_latest",
        type: "assistant",
        agent: "build",
        model: { ...model, variant: "high" },
        time: { created: 3, completed: 4 },
        content: [],
        tokens,
      };
      const fixture = prepareFixture(({ url, method }) => {
        if (method === "GET" && url.pathname === "/api/session/ses_saved")
          return response(session({ tokens: { ...tokens, input: 99999 } }));
        if (!url.pathname.endsWith("/message")) return undefined;
        return url.searchParams.has("cursor")
          ? cursorPage([
              latest,
              { id: "msg_boundary", type: "user", text: "Continue", time: { created: 4 } },
            ])
          : cursorPage(
              [
                {
                  ...latest,
                  id: "msg_old",
                  time: { created: 1 },
                  tokens: { ...tokens, input: 88888 },
                },
              ],
              "next-page",
            );
      });
      const runtime = await fixture.prepare();
      const measured = Promise.withResolvers<void>();
      const cleared = Promise.withResolvers<void>();
      const signals: OpencodeSessionRuntimeSignal[] = [];
      try {
        const readStart = fixture.requests.length;
        expect(await runtime.connection.loadContextUsage(ref)).toEqual({
          totalTokens: 3170,
          model: { providerId: "test", modelId: "test-model", variant: "high" },
        });
        expect(fixture.requests.slice(readStart).every(({ method }) => method === "GET")).toBe(
          true,
        );
        const read = await runtime.connection.readSessionSources(ref.repoPath, [
          { ...ref, sessionScope: { kind: "repository" } },
        ]);
        expect(read.failures).toEqual([]);
        expect(read.sources[0]).toMatchObject({ contextUsage: { totalTokens: 3170 } });
        await runtime.startForwarding((signal) => {
          signals.push(signal);
          if (signal.type !== "context_updated") return;
          if (signal.contextUsage?.totalTokens === 88) measured.resolve();
          if (signal.contextUsage === null) cleared.resolve();
        });
        fixture.channel.push({
          id: "evt_step_started",
          created: 5,
          type: "session.step.started",
          data: {
            sessionID: ref.externalSessionId,
            assistantMessageID: "msg_live",
            started: 5,
            agent: "build",
            model,
          },
        });
        const step = {
          id: "evt_step_terminal",
          created: 6,
          durable,
          data: {
            sessionID: ref.externalSessionId,
            assistantMessageID: "msg_live",
            tokens: { input: 50, output: 10, reasoning: 5, cache: { read: 20, write: 3 } },
            cost: 0,
          },
        };
        fixture.channel.push(
          ending === "ended"
            ? { ...step, type: "session.step.ended", data: { ...step.data, finish: "stop" } }
            : {
                ...step,
                type: "session.step.failed",
                data: { ...step.data, error: { message: "Native step failed" } },
              },
        );
        await measured.promise;
        fixture.channel.push({
          id: "evt_revert_staged",
          created: 7,
          durable: { ...durable, seq: 2 },
          type: "session.revert.staged",
          data: { sessionID: ref.externalSessionId, revert: { messageID: "msg_boundary" } },
        });
        fixture.channel.push({
          id: "evt_revert_cleared",
          created: 8,
          durable: { ...durable, seq: 3 },
          type: "session.revert.cleared",
          data: { sessionID: ref.externalSessionId },
        });
        fixture.channel.push({
          id: "evt_compaction_ended",
          created: 9,
          durable: { ...durable, seq: 4 },
          type: "session.compaction.ended",
          data: {
            sessionID: ref.externalSessionId,
            reason: "manual",
            text: "Summary",
            recent: "Recent context",
          },
        });
        await cleared.promise;
        expect(
          signals
            .filter((signal) => signal.type === "context_updated")
            .map((signal) => signal.contextUsage),
        ).toEqual([
          { totalTokens: 88, model: { providerId: "test", modelId: "test-model" } },
          {
            totalTokens: 3170,
            model: { providerId: "test", modelId: "test-model", variant: "high" },
          },
          { totalTokens: 88, model: { providerId: "test", modelId: "test-model" } },
          null,
        ]);
      } finally {
        await runtime.release();
      }
    },
  );

  test.each([
    {
      label: "completed compaction",
      status: "completed" as const,
      boundary: undefined,
      expected: null,
    },
    { label: "failed compaction", status: "failed" as const, boundary: undefined, expected: 115 },
    { label: "staged revert", status: "failed" as const, boundary: "msg_recent", expected: 15 },
    {
      label: "missing revert boundary",
      status: "failed" as const,
      boundary: "msg_missing",
      expected: null,
    },
  ])("uses the TUI context boundary for $label", async ({ status, boundary, expected }) => {
    const assistant: SessionMessageInfo = {
      id: "msg_old",
      type: "assistant",
      agent: "build",
      model,
      time: { created: 1 },
      content: [],
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const compaction: Extract<SessionMessageInfo, { type: "compaction" }> = {
      id: "msg_compact",
      type: "compaction",
      status,
      reason: "manual",
      summary: "",
      recent: "",
      time: { created: 3 },
    };
    if (status === "failed") compaction.error = { name: "UnknownError", message: "Cancelled" };
    const fixture = prepareFixture(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/session/ses_saved")
        return response(session(boundary ? { revert: { messageID: boundary } } : {}));
      if (url.pathname.endsWith("/message"))
        return cursorPage([
          assistant,
          {
            ...assistant,
            id: "msg_recent",
            time: { created: 2 },
            tokens: { ...assistant.tokens!, input: 110 },
          },
          compaction,
        ]);
      return undefined;
    });
    const runtime = await fixture.prepare();
    try {
      expect((await runtime.connection.loadContextUsage(ref))?.totalTokens ?? null).toBe(expected);
    } finally {
      await runtime.release();
    }
  });

  test("keeps workspace MCP bindings and source reads separate on a shared runtime", async () => {
    const roots = ["/repo-a", "/repo-b"].map((repoPath, index) => ({
      ...ref,
      repoPath,
      workingDirectory: `${repoPath}/worktree`,
      externalSessionId: `ses_${index}`,
      sessionScope: { kind: "repository" as const },
    }));
    const resolved: string[] = [];
    const fixture = prepareFixture(
      ({ url, method }) => {
        const root = roots.find(
          (root) => url.pathname === `/api/session/${root.externalSessionId}`,
        );
        if (root && method === "GET")
          return response(
            session({ id: root.externalSessionId, location: { directory: root.workingDirectory } }),
          );
        if (url.pathname === "/api/location")
          return Response.json({
            ...location,
            directory: url.searchParams.get("location[directory]"),
          });
        return undefined;
      },
      async (repoPath) => {
        resolved.push(repoPath);
        return { command: ["odt-mcp"], environment: { OPENDUCKTOR_WORKSPACE_ID: repoPath } };
      },
    );
    const runtime = await fixture.prepare();
    try {
      for (const root of roots) {
        const read = await runtime.connection.readSessionSources(root.repoPath, [root]);
        expect(read.failures).toEqual([]);
        expect(read.sources.map((source) => source.repoPath)).toEqual([root.repoPath]);
      }
      expect(resolved).toEqual([]);
      expect(fixture.requests.every(({ method }) => method === "GET")).toBe(true);
      for (const root of roots) {
        await runtime.connection.resumeSession({ ...root, runtimePolicy: { kind: "opencode" } });
      }
      expect(resolved).toEqual(["/repo-a", "/repo-b"]);
      const installs = fixture.requests.filter(
        ({ url }) => url.pathname === "/api/experimental/mcp/openducktor",
      );
      expect(
        installs.map(({ url, body }) => ({
          directory: url.searchParams.get("location[directory]"),
          config: body.config,
        })),
      ).toEqual(
        roots.map((root) => ({
          directory: root.workingDirectory,
          config: {
            type: "local",
            command: ["odt-mcp"],
            environment: { OPENDUCKTOR_WORKSPACE_ID: root.repoPath },
            codemode: false,
          },
        })),
      );
      expect(
        (await runtime.connection.readSessionSources(roots[0]!.repoPath)).sources.map(
          (source) => source.externalSessionId,
        ),
      ).toEqual([roots[0]!.externalSessionId]);
      const foreign = { ...roots[0]!, repoPath: "/foreign" };
      const rejected = await runtime.connection.readSessionSources(foreign.repoPath, [foreign]);
      expect(rejected.sources).toEqual([]);
      expect(rejected.failures[0]?.runtimeOperationFailure?.code).toBe("identity_mismatch");
      expect(resolved).toEqual(["/repo-a", "/repo-b"]);
      expect(
        fixture.requests.filter(({ url }) => url.pathname === "/api/experimental/mcp/openducktor"),
      ).toHaveLength(2);
    } finally {
      await runtime.release();
    }
  });

  for (const [operation, externalSessionId] of [
    ["stopSession", ref.externalSessionId],
    ["releaseSession", ref.externalSessionId],
    ["releaseSession", "ses_grandchild"],
  ] as const) {
    test(`rejects unsent input for ${externalSessionId} held by attachment when ${operation} completes`, async () => {
      const started = Promise.withResolvers<void>();
      const finishRead = Promise.withResolvers<void>();
      const target = { ...ref, externalSessionId };
      const descendants =
        externalSessionId === ref.externalSessionId
          ? []
          : [
              session({ id: "ses_child", parentID: ref.externalSessionId }),
              session({ id: "ses_grandchild", parentID: "ses_child" }),
            ];
      let deferRead = externalSessionId === ref.externalSessionId;
      const fixture = prepareFixture(({ url }) => {
        if (deferRead && url.pathname === `/api/session/${externalSessionId}/message`) {
          started.resolve();
          return finishRead.promise.then(() => cursorPage([]));
        }
        if (url.pathname.endsWith("/interrupt")) return Response.json({});
        if (url.pathname === "/api/session")
          return Response.json({
            data: descendants.filter(
              (detail) => detail.parentID === url.searchParams.get("parentID"),
            ),
            cursor: { next: null, prev: null },
          });
        const detail = descendants.find((detail) => url.pathname === `/api/session/${detail.id}`);
        if (detail) return response(detail);
        return undefined;
      });
      const runtime = await fixture.prepare();
      const roots = [{ ...ref, sessionScope: { kind: "repository" as const } }];
      if (externalSessionId !== ref.externalSessionId) {
        const attached = await runtime.connection.readSessionSources(ref.repoPath, roots);
        expect(attached.failures).toEqual([]);
        expect(attached.sources.map((source) => source.externalSessionId)).toContain(
          externalSessionId,
        );
        deferRead = true;
      }
      const reading = runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      await Promise.race([
        started.promise,
        reading.then((read) => {
          throw new Error(
            `Source read completed before attachment gate: ${JSON.stringify(read.failures)}`,
          );
        }),
      ]);
      const sending = runtime.connection.sendUserMessage({
        ...target,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text: "Keep draft" }],
      });
      void sending.catch(() => undefined);
      try {
        await runtime.connection[operation](ref);
        finishRead.resolve();
        const rejection = await sending.catch((cause: unknown) => cause);
        await reading;
        expect(
          fixture.requests.some(({ url }) => /\/(prompt|command|compact)$/.test(url.pathname)),
        ).toBe(false);
        expect(rejection).toBeInstanceOf(OpenCodeOperationError);
        expect(rejection).toMatchObject({
          message: expect.stringContaining("before this input was submitted"),
        });
        const afterCancellation = await runtime.connection.readSessionSources(ref.repoPath);
        expect(afterCancellation.failures).toEqual([]);
        expect(afterCancellation.sources).toHaveLength(operation === "stopSession" ? 1 : 0);
        if (operation === "stopSession")
          expect(afterCancellation.sources[0]?.runtimeActivity).toBe("idle");
      } finally {
        finishRead.resolve();
        await runtime.release();
        await Promise.allSettled([reading, sending]);
      }
    });
  }

  test("shares an in-flight MCP install when two linked sessions attach in one directory", async () => {
    const directory = "/repo/worktree";
    const installing = Promise.withResolvers<void>();
    const finishInstall = Promise.withResolvers<Response>();
    let nativeOverrideExists = false;
    let mcpAdds = 0;
    const fixture = prepareFixture(({ url, method }) => {
      if (url.pathname === "/api/mcp" && url.searchParams.get("location[directory]") === directory)
        return Response.json({
          location: { directory },
          data: nativeOverrideExists
            ? [{ name: "openducktor", status: { status: "connected" } }]
            : [],
        });
      if (
        url.pathname === "/api/experimental/mcp/openducktor" &&
        url.searchParams.get("location[directory]") === directory
      ) {
        nativeOverrideExists = true;
        mcpAdds++;
        installing.resolve();
        return finishInstall.promise;
      }
      if (method === "GET" && /^\/api\/session\/ses_worktree_[12]$/.test(url.pathname))
        return response(session({ id: url.pathname.split("/").at(-1)!, location: { directory } }));
      if (
        url.pathname === "/api/location" &&
        url.searchParams.get("location[directory]") === directory
      )
        return Response.json({ ...location, directory });
      return undefined;
    });
    const runtime = await fixture.prepare();
    const resume = (id: string) =>
      runtime.connection.resumeSession({
        ...ref,
        workingDirectory: directory,
        externalSessionId: id,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository" },
      });
    try {
      const first = resume("ses_worktree_1");
      await installing.promise;
      const second = resume("ses_worktree_2");
      // Let the second attach reach the already published native override.
      await Bun.sleep(0);
      finishInstall.resolve(noContent());
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.externalSessionId)).toEqual([
        "ses_worktree_1",
        "ses_worktree_2",
      ]);
      expect(mcpAdds).toBe(1);
    } finally {
      finishInstall.resolve(noContent());
      await runtime.release();
    }
  });
  test("restores only authorized roots and binds MCP when the conversation resumes", async () => {
    const fixture = prepareFixture();
    const runtime = await fixture.prepare();
    try {
      expect(await runtime.connection.readSessionSources(ref.repoPath, [])).toEqual({
        sources: [],
        failures: [],
      });
      expect(fixture.requests.some((request) => request.url.pathname === "/api/session")).toBe(
        false,
      );
      const sources = await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      expect(fixture.requests.every(({ method }) => method === "GET")).toBe(true);
      expect(sources.failures).toEqual([]);
      expect(sources.sources.map((source) => source.externalSessionId)).toEqual(["ses_saved"]);
      expect(
        fixture.requests
          .filter((request) => request.url.pathname === "/api/session")
          .map((request) => request.url.searchParams.get("parentID")),
      ).toEqual(["ses_saved"]);
      await runtime.connection.resumeSession({
        ...ref,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository" },
      });
      const mcp = fixture.requests.find(
        (request) => request.url.pathname === "/api/experimental/mcp/openducktor",
      );
      expect(mcp?.url.searchParams.get("location[directory]")).toBe("/repo");
      expect(mcp?.body).toEqual({
        config: {
          type: "local",
          command: ["odt-mcp"],
          environment: { OPENDUCKTOR_WORKSPACE_ID: "workspace-1" },
          codemode: false,
        },
      });
    } finally {
      await runtime.release();
    }
  });
  test("retains parked input and synthetic results through reconnect without resubmission", async () => {
    const parkedDisplayParts = [
      { kind: "text", text: "Keep @review parked" },
      {
        kind: "skill_mention",
        skill: {
          id: "skill_native_review",
          name: "review",
          path: "skill_native_review",
        },
        sourceText: { value: "@review", start: 5, end: 12 },
      },
    ];
    const fixture = prepareFixture(({ url }) =>
      url.pathname.endsWith("/inbox")
        ? response([
            {
              id: "msg_parked",
              sessionID: ref.externalSessionId,
              type: "user",
              payload: {
                text: "Keep @review parked",
                skills: [
                  {
                    id: "skill_native_review",
                    name: "review",
                    text: "Check the native contract.",
                    mention: { text: "@review", start: 5, end: 12 },
                  },
                ],
              },
              delivery: "prompt",
              time: { created: 8 },
            },
            {
              id: "msg_background",
              sessionID: ref.externalSessionId,
              type: "synthetic",
              payload: {
                text: "Native background shell result",
                description: "Shell completed",
                metadata: { source: "shell" },
              },
              delivery: "steer",
              time: { created: 9 },
            },
          ])
        : undefined,
    );
    const runtime = await fixture.prepare();
    try {
      const read = await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      expect(read.sources[0]?.queuedMessages).toMatchObject([
        {
          type: "user_message",
          messageId: "msg_parked",
          message: "Keep @review parked",
          state: "queued",
          parts: parkedDisplayParts,
        },
      ]);
      const settled = Promise.withResolvers<void>();
      const restored = Promise.withResolvers<void>();
      const signals: OpencodeSessionRuntimeSignal[] = [];
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (signal.type === "session_source") restored.resolve();
        if (signal.type === "session_event" && signal.event.type === "session_idle")
          settled.resolve();
      });
      fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
      await restored.promise;
      expect(
        signals.some(
          (signal) =>
            signal.type === "session_event" &&
            signal.event.type === "session_policy_notice" &&
            signal.event.messageId === "msg_background",
        ),
      ).toBe(false);
      const delivery: V2Event = {
        id: "evt_background_delivered",
        type: "session.inbox.delivered",
        created: 10,
        durable,
        data: { sessionID: ref.externalSessionId, inboxID: "msg_background" },
      };
      fixture.channel.push(delivery);
      fixture.channel.push(delivery);
      fixture.channel.push({
        id: "evt_parked_delivered",
        type: "session.inbox.delivered",
        created: 10,
        durable: { ...durable, seq: 2 },
        data: { sessionID: ref.externalSessionId, inboxID: "msg_parked" },
      });
      fixture.channel.push({
        id: "evt_idle",
        type: "session.idle",
        created: 11,
        data: { sessionID: ref.externalSessionId },
      });
      await settled.promise;
      expect(signals).toContainEqual({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "session_policy_notice",
          externalSessionId: ref.externalSessionId,
          messageId: "msg_background",
          message: "Native background shell result",
          timestamp: new Date(10).toISOString(),
        },
      });
      expect(
        signals.filter(
          (signal) =>
            signal.type === "session_event" &&
            signal.event.type === "session_policy_notice" &&
            signal.event.messageId === "msg_background",
        ),
      ).toHaveLength(1);
      expect(signals).toContainEqual({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "user_message",
          externalSessionId: ref.externalSessionId,
          messageId: "msg_parked",
          message: "Keep @review parked",
          parts: parkedDisplayParts,
          state: "read",
          timestamp: new Date(10).toISOString(),
        },
      });
      expect(fixture.requests.some(({ url }) => url.pathname.endsWith("/prompt"))).toBe(false);
    } finally {
      await runtime.release();
    }
  });
  test("releases bound descendants and keeps another workspace attached", async () => {
    const descendants = [
      session({ id: "ses_child", parentID: ref.externalSessionId }),
      session({ id: "ses_grandchild", parentID: "ses_child" }),
    ];
    const otherRef = {
      ...ref,
      repoPath: "/other",
      workingDirectory: "/other",
      externalSessionId: "ses_other",
    };
    const other = session({
      id: otherRef.externalSessionId,
      location: { directory: otherRef.workingDirectory },
    });
    const orphan = session({ id: "ses_orphan", parentID: "ses_grandchild" });
    const otherChild = session({
      id: "ses_other_child",
      parentID: other.id,
      location: other.location,
    });
    const details = [...descendants, other, orphan, otherChild];
    const fixture = prepareFixture(({ url, method }) => {
      if (
        url.pathname === "/api/location" &&
        url.searchParams.get("location[directory]") === otherRef.workingDirectory
      )
        return Response.json({ ...location, directory: otherRef.workingDirectory });
      if (url.pathname === "/api/session")
        return Response.json({
          data: descendants.filter(
            (detail) => detail.parentID === url.searchParams.get("parentID"),
          ),
          cursor: { next: null, prev: null },
        });
      const detail = details.find((detail) => url.pathname === `/api/session/${detail.id}`);
      return detail && method === "GET" ? response(detail) : undefined;
    });
    const runtime = await fixture.prepare();
    const signals: OpencodeSessionRuntimeSignal[] = [];
    const observed = Promise.withResolvers<void>();
    const roots = [{ ...ref, sessionScope: { kind: "repository" as const } }];
    try {
      const attached = await runtime.connection.readSessionSources(ref.repoPath, roots);
      expect(attached.failures).toEqual([]);
      expect(attached.sources.map((source) => source.externalSessionId)).toEqual([
        ref.externalSessionId,
        "ses_child",
        "ses_grandchild",
      ]);
      const otherAttached = await runtime.connection.readSessionSources(otherRef.repoPath, [
        { ...otherRef, sessionScope: { kind: "repository" } },
      ]);
      expect(otherAttached.failures).toEqual([]);
      await expect(
        runtime.connection.releaseSession({ ...ref, workingDirectory: "/wrong" }),
      ).rejects.toMatchObject({
        failure: { runtimeOperationFailure: { code: "identity_mismatch" } },
      });
      const retained = await runtime.connection.readSessionSources(ref.repoPath);
      expect(retained.sources.map((source) => source.externalSessionId)).toEqual(
        attached.sources.map((source) => source.externalSessionId),
      );
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (signal.type === "runtime_notice") observed.resolve();
        if (signal.type === "fault" || signal.type === "session_fault")
          observed.reject(new Error(signal.message));
      });
      await runtime.connection.releaseSession(ref);
      expect((await runtime.connection.readSessionSources(ref.repoPath)).sources).toEqual([]);
      fixture.channel.push(sessionCreated(orphan));
      fixture.channel.push(sessionCreated(otherChild));
      fixture.channel.push({
        id: "release_observed",
        type: "tui.toast.show",
        data: { message: "Release observed", variant: "warning" },
      });
      await observed.promise;
      expect(
        signals.flatMap((signal) =>
          signal.type === "session_source" ? [signal.source.externalSessionId] : [],
        ),
      ).toEqual([otherChild.id]);
      expect(
        fixture.requests.some(
          ({ url, method }) => method === "DELETE" || url.pathname.endsWith("/interrupt"),
        ),
      ).toBe(false);
    } finally {
      await runtime.release();
    }
  });

  test.each(["metadata", "snapshot"] as const)(
    "ignores a child %s read that completes after root release",
    async (phase) => {
      const child = session({ id: "ses_child", parentID: ref.externalSessionId });
      const entered = Promise.withResolvers<void>();
      const continueRead = Promise.withResolvers<void>();
      const observed = Promise.withResolvers<void>();
      const fixture = prepareFixture(({ url, method }) => {
        if (url.pathname === `/api/session/${child.id}` && method === "GET") {
          if (phase === "metadata") {
            entered.resolve();
            return continueRead.promise.then(() => response(child));
          }
          return response(child);
        }
        if (phase === "snapshot" && url.pathname === `/api/session/${child.id}/message`) {
          entered.resolve();
          return continueRead.promise.then(() => cursorPage([]));
        }
        return undefined;
      });
      const runtime = await fixture.prepare();
      const signals: OpencodeSessionRuntimeSignal[] = [];
      try {
        expect(
          (
            await runtime.connection.readSessionSources(ref.repoPath, [
              { ...ref, sessionScope: { kind: "repository" } },
            ])
          ).failures,
        ).toEqual([]);
        await runtime.startForwarding((signal) => {
          signals.push(signal);
          if (signal.type === "runtime_notice") observed.resolve();
          if (signal.type === "fault" || signal.type === "session_fault")
            observed.reject(new Error(signal.message));
        });
        fixture.channel.push(sessionCreated(child));
        await entered.promise;
        await runtime.connection.releaseSession(ref);
        continueRead.resolve();
        fixture.channel.push({
          id: "child_read_observed",
          type: "tui.toast.show",
          data: { message: "Child read observed", variant: "warning" },
        });
        await observed.promise;
        expect(signals.filter((signal) => signal.type !== "runtime_notice")).toEqual([]);
      } finally {
        continueRead.resolve();
        await runtime.release();
      }
    },
  );

  test.each([ref.externalSessionId, "ses_child", "ses_grandchild"])(
    "does not deliver queued input from released %s after root reattachment",
    async (externalSessionId) => {
      const descendants = [
        session({ id: "ses_child", parentID: ref.externalSessionId }),
        session({ id: "ses_grandchild", parentID: "ses_child" }),
      ];
      let inbox: SessionInboxUser[] = [
        {
          id: "msg_old_queued",
          sessionID: externalSessionId,
          type: "user",
          delivery: "queue",
          payload: { text: "Previous attachment's queued text" },
          time: { created: 3 },
        },
      ];
      const fixture = prepareFixture(({ url }) => {
        if (url.pathname.endsWith("/inbox"))
          return response(url.pathname === `/api/session/${externalSessionId}/inbox` ? inbox : []);
        if (url.pathname === "/api/session")
          return Response.json({
            data: descendants.filter(
              (detail) => detail.parentID === url.searchParams.get("parentID"),
            ),
            cursor: { next: null, prev: null },
          });
        const detail = descendants.find((detail) => url.pathname === `/api/session/${detail.id}`);
        return detail ? response(detail) : undefined;
      });
      const runtime = await fixture.prepare();
      const signals: OpencodeSessionRuntimeSignal[] = [];
      const settled = Promise.withResolvers<void>();
      const roots = [{ ...ref, sessionScope: { kind: "repository" as const } }];
      try {
        const initial = await runtime.connection.readSessionSources(ref.repoPath, roots);
        expect(initial.failures).toEqual([]);
        expect(
          initial.sources.find((source) => source.externalSessionId === externalSessionId)
            ?.queuedMessages,
        ).toMatchObject([{ messageId: "msg_old_queued" }]);
        await runtime.startForwarding((signal) => {
          signals.push(signal);
          if (
            signal.type === "session_event" &&
            signal.externalSessionId === externalSessionId &&
            signal.event.type === "session_idle" &&
            signal.event.timestamp === new Date(6).toISOString()
          )
            settled.resolve();
          if (signal.type === "fault" || signal.type === "session_fault")
            settled.reject(new Error(signal.message));
        });
        await runtime.connection.releaseSession(ref);
        inbox = [
          {
            id: "msg_new_queued",
            sessionID: externalSessionId,
            type: "user",
            delivery: "queue",
            payload: { text: "New attachment's queued text" },
            time: { created: 4 },
          },
        ];
        const restored = await runtime.connection.readSessionSources(ref.repoPath, roots);
        expect(restored.failures).toEqual([]);
        expect(
          restored.sources.find((source) => source.externalSessionId === externalSessionId)
            ?.queuedMessages,
        ).toMatchObject([{ messageId: "msg_new_queued" }]);
        for (const [index, inboxID] of ["msg_old_queued", "msg_new_queued"].entries())
          fixture.channel.push({
            id: `evt_delivered_${index}`,
            created: 5,
            type: "session.inbox.delivered",
            durable: { ...durable, aggregateID: externalSessionId, seq: index + 1 },
            data: { sessionID: externalSessionId, inboxID },
          });
        fixture.channel.push({
          id: "evt_settled",
          created: 6,
          type: "session.idle",
          data: { sessionID: externalSessionId },
        });
        await settled.promise;
        expect(
          signals.flatMap((signal) =>
            signal.type === "session_event" && signal.event.type === "user_message"
              ? [signal.event]
              : [],
          ),
        ).toMatchObject([
          { messageId: "msg_new_queued", message: "New attachment's queued text", state: "read" },
        ]);
      } finally {
        await runtime.release();
      }
    },
  );

  test("retracts missing history and queued input and keeps buffered deliveries on reconnect", async () => {
    let reconnecting = false;
    const inbox = Promise.withResolvers<Response>();
    const snapshot = Promise.withResolvers<void>();
    const observed = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const fixture = prepareFixture(({ url }) => {
      if (url.pathname.endsWith("/inbox") && reconnecting) return inbox.promise;
      if (!url.pathname.endsWith("/message")) return undefined;
      if (reconnecting) {
        fixture.channel.push({
          id: "evt_result_delivered",
          created: 10,
          type: "session.inbox.delivered",
          durable: { ...durable, seq: 5 },
          data: { sessionID: ref.externalSessionId, inboxID: "msg_result" },
        });
        fixture.channel.push({
          id: "evt_user_delivered",
          created: 10,
          type: "session.inbox.delivered",
          durable: { ...durable, seq: 6 },
          data: { sessionID: ref.externalSessionId, inboxID: "msg_delivered_user" },
        });
        inbox.resolve(response([]));
      }
      const messages: SessionMessageInfo[] = [backgroundLaunch()];
      if (reconnecting)
        messages.push({
          id: "msg_read_user",
          type: "user",
          text: "Already delivered",
          time: { created: 9 },
        });
      else
        messages.push(
          {
            id: "msg_reverted_user",
            type: "user",
            text: "Reverted user message",
            time: { created: 3 },
          },
          {
            id: "msg_reverted_assistant",
            type: "assistant",
            agent: "build",
            model,
            content: [{ type: "text", text: "Reverted assistant reply" }],
            time: { created: 4, completed: 5 },
          },
        );
      return cursorPage(messages);
    });
    const runtime = await fixture.prepare();
    const signals: OpencodeSessionRuntimeSignal[] = [];
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (signal.type === "session_source") snapshot.resolve();
        if (signal.type === "session_event" && signal.event.type === "session_idle") {
          if (signal.event.timestamp === new Date(8).toISOString()) observed.resolve();
          if (signal.event.timestamp === new Date(11).toISOString()) settled.resolve();
        }
      });
      fixture.channel.push({
        id: "evt_result_enqueued",
        created: 6,
        type: "session.inbox.enqueued",
        durable,
        data: {
          sessionID: ref.externalSessionId,
          inboxID: "msg_result",
          item: {
            type: "synthetic",
            delivery: "steer",
            payload: {
              text: "Native child result",
              metadata: { source: "subagent", childID: "ses_child", state: "completed" },
            },
          },
        },
      });
      for (const [index, item] of [
        { id: "msg_stale_user", text: "Removed natively" },
        { id: "msg_delivered_user", text: "Delivery behind the snapshot" },
        { id: "msg_read_user", text: "Already delivered" },
      ].entries())
        fixture.channel.push({
          id: `evt_${item.id}_enqueued`,
          created: 7,
          type: "session.inbox.enqueued",
          durable: { ...durable, seq: index + 2 },
          data: {
            sessionID: ref.externalSessionId,
            inboxID: item.id,
            item: { type: "user", delivery: "queue", payload: { text: item.text } },
          },
        });
      fixture.channel.push({
        id: "evt_observed",
        created: 8,
        type: "session.idle",
        data: { sessionID: ref.externalSessionId },
      });
      await observed.promise;
      reconnecting = true;
      fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
      await snapshot.promise;
      fixture.channel.push({
        id: "evt_settled",
        created: 11,
        type: "session.idle",
        data: { sessionID: ref.externalSessionId },
      });
      await settled.promise;
      expect(signals.filter((signal) => signal.type === "fault")).toEqual([]);
      expect(signals.find((signal) => signal.type === "session_source")).toMatchObject({
        source: { queuedMessages: [] },
      });
      const retractions = signals.flatMap((signal, index) =>
        signal.type === "session_event" && signal.event.type === "transcript_retracted"
          ? [{ ...signal, event: signal.event, index }]
          : [],
      );
      expect(retractions).toMatchObject([
        {
          externalSessionId: ref.externalSessionId,
          provenance: "baseline",
        },
      ]);
      expect(retractions[0]!.event.messageIds.toSorted()).toEqual(
        [
          "msg_reverted_user",
          "msg_reverted_assistant",
          "msg_stale_user",
          "msg_delivered_user",
        ].toSorted(),
      );
      expect(retractions[0]!.index).toBeLessThan(
        signals.findIndex(
          (signal) =>
            signal.type === "session_event" &&
            signal.provenance === "baseline" &&
            signal.event.type !== "transcript_retracted",
        ),
      );
      expect(signals).toContainEqual({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "user_message",
          externalSessionId: ref.externalSessionId,
          messageId: "msg_delivered_user",
          message: "Delivery behind the snapshot",
          parts: [{ kind: "text", text: "Delivery behind the snapshot" }],
          state: "read",
          timestamp: new Date(10).toISOString(),
        },
      });
      expect(
        signals.filter(
          (signal) =>
            signal.type === "session_event" &&
            signal.event.type === "session_policy_notice" &&
            signal.event.messageId === "msg_result",
        ),
      ).toEqual([
        {
          type: "session_event",
          externalSessionId: ref.externalSessionId,
          event: {
            type: "session_policy_notice",
            externalSessionId: ref.externalSessionId,
            messageId: "msg_result",
            message: "Native child result",
            timestamp: new Date(10).toISOString(),
          },
        },
      ]);
      expect(
        signals
          .filter(
            (signal) =>
              signal.type === "session_event" &&
              signal.event.type === "assistant_part" &&
              signal.event.part.kind === "subagent",
          )
          .at(-1),
      ).toMatchObject({
        event: { part: { partId: "call_child:subagent", status: "completed", endedAtMs: 10 } },
      });
      expect(fixture.requests.some(({ url }) => url.pathname.endsWith("/prompt"))).toBe(false);
    } finally {
      inbox.resolve(response([]));
      await runtime.release();
    }
  });
  test.each([
    { label: "partial arguments", delta: '{"code":"console.', settled: false },
    { label: "valid JSON before input.ended", delta: '{"code":"console.log(42)"}', settled: false },
    { label: "completed arguments", delta: '{"code":"console.log(42)"}', settled: true },
  ])(
    "preserves tool preparation and queuing on reconnect for $label",
    async ({ delta, settled }) => {
      const message: SessionMessageInfo = {
        id: "msg_native",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 2 },
        content: [
          {
            type: "tool",
            id: "call_native",
            name: "execute",
            time: { created: 3 },
            state: { status: "streaming", input: "" },
          },
        ],
      };
      let reconnecting = false;
      const fixture = prepareFixture(({ url }) => {
        if (!url.pathname.endsWith("/message")) return undefined;
        return cursorPage([
          reconnecting && settled
            ? {
                ...message,
                content: [{ ...message.content[0]!, state: { status: "streaming", input: delta } }],
              }
            : message,
        ]);
      });
      const runtime = await fixture.prepare();
      const prepared = Promise.withResolvers<void>();
      const restored = Promise.withResolvers<OpencodeSessionRuntimeSignal>();
      try {
        await runtime.connection.readSessionSources(ref.repoPath, [
          { ...ref, sessionScope: { kind: "repository" } },
        ]);
        await runtime.startForwarding((signal) => {
          if (signal.type === "fault" && reconnecting) restored.reject(new Error(signal.message));
          if (
            signal.type !== "session_event" ||
            signal.event.type !== "assistant_part" ||
            signal.event.part.kind !== "tool"
          )
            return;
          if (reconnecting) restored.resolve(signal);
          else if (signal.event.part.inputStreaming === !settled) prepared.resolve();
        });
        fixture.channel.push({
          id: "evt_input_delta",
          created: 4,
          type: "session.tool.input.delta",
          data: {
            sessionID: ref.externalSessionId,
            assistantMessageID: message.id,
            id: "call_native",
            delta,
          },
        });
        if (settled)
          fixture.channel.push({
            id: "evt_input_ended",
            created: 5,
            type: "session.tool.input.ended",
            durable,
            data: {
              sessionID: ref.externalSessionId,
              assistantMessageID: message.id,
              id: "call_native",
              text: delta,
            },
          });
        await prepared.promise;
        reconnecting = true;
        fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
        const signal = await restored.promise;
        expect(signal).toMatchObject({
          provenance: "baseline",
          event: {
            part: {
              kind: "tool",
              partId: "call_native",
              status: "pending",
              inputStreaming: !settled,
            },
          },
        });
        if (signal.type !== "session_event" || signal.event.type !== "assistant_part")
          throw new Error("Expected the restored tool event");
        expect(signal.event.part).not.toHaveProperty("startedAtMs");
        if (settled)
          expect(signal.event.part).toMatchObject({ input: { code: "console.log(42)" } });
        else expect(signal.event.part).not.toHaveProperty("input");
        expect(fixture.requests.some(({ url }) => /\/(prompt|command)$/.test(url.pathname))).toBe(
          false,
        );
      } finally {
        await runtime.release();
      }
    },
  );
  test("reconciles a held reconnect snapshot with queued native starts and deltas", async () => {
    const message: SessionMessageInfo = {
      id: "msg_native",
      type: "assistant",
      agent: "build",
      model,
      time: { created: 2 },
      content: [
        { type: "text", text: "Hello" },
        {
          type: "tool",
          id: "call_native",
          name: "read",
          time: { created: 3, ran: 4 },
          state: { status: "running", input: { path: "a.txt" }, metadata: {} },
        },
      ],
    };
    let restoring = false;
    const reading = Promise.withResolvers<void>();
    const snapshot = Promise.withResolvers<Response>();
    const fixture = prepareFixture(({ url }) => {
      if (!url.pathname.endsWith("/message")) return undefined;
      if (!restoring) return cursorPage([message]);
      reading.resolve();
      return snapshot.promise;
    });
    const runtime = await fixture.prepare();
    const signals: OpencodeSessionRuntimeSignal[] = [];
    const completed = Promise.withResolvers<void>();
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (
          signal.type === "session_event" &&
          signal.event.type === "assistant_part" &&
          signal.event.part.kind === "tool" &&
          signal.event.part.status === "completed"
        )
          completed.resolve();
      });
      restoring = true;
      fixture.channel.push({ id: "connected-2", type: "server.connected", data: {} });
      await reading.promise;
      fixture.channel.push({
        id: "evt_text_delta",
        created: 5,
        type: "session.text.delta",
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: message.id,
          ordinal: 0,
          delta: "Hello",
        },
      });
      fixture.channel.push({
        id: "evt_tool_start",
        created: 3,
        type: "session.tool.input.started",
        durable,
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: message.id,
          id: "call_native",
          name: "read",
        },
      });
      fixture.channel.push({
        id: "evt_tool_called",
        created: 4,
        type: "session.tool.called",
        durable: { ...durable, seq: 2 },
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: message.id,
          id: "call_native",
          input: { path: "a.txt" },
        },
      });
      fixture.channel.push({
        id: "evt_tool_success",
        created: 6,
        type: "session.tool.success",
        durable: { ...durable, seq: 3 },
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: message.id,
          id: "call_native",
          content: [{ type: "text", text: "Done" }],
        },
      });
      snapshot.resolve(cursorPage([message]));
      await completed.promise;
      expect(signals.some((signal) => signal.type === "observation_reset")).toBe(true);
      const parts = signals.flatMap((signal) =>
        signal.type === "session_event" && signal.event.type === "assistant_part"
          ? [signal.event.part]
          : [],
      );
      expect(
        parts.filter((part) => part.kind === "text").every((part) => part.text === "Hello"),
      ).toBe(true);
      const lastTool = parts.filter((part) => part.kind === "tool").at(-1);
      expect(lastTool).toMatchObject({
        partId: "call_native",
        status: "completed",
        output: "Done",
      });
      expect(parts.filter((part) => part.kind === "tool" && part.status === "pending")).toEqual([]);
    } finally {
      await runtime.release();
    }
  });
  test.each(["native event", "synchronous listener", "asynchronous listener"] as const)(
    "reports a failed %s once and allows its fault listener to release the runtime",
    async (failure) => {
      const fixture = prepareFixture();
      const runtime = await fixture.prepare();
      const signals: OpencodeSessionRuntimeSignal[] = [];
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      let resolveNotice!: () => void;
      const noticed = new Promise<void>((resolve) => {
        resolveNotice = resolve;
      });
      let resolveRelease!: () => void;
      const released = new Promise<void>((resolve) => {
        resolveRelease = resolve;
      });
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (signal.type === "runtime_notice") {
          resolveNotice();
          if (failure === "synchronous listener") throw new Error("Synchronous delivery failed");
          if (failure === "asynchronous listener")
            return Promise.reject(new Error("Asynchronous delivery failed"));
        }
        if (signal.type === "fault") {
          return runtime.release().then(resolveRelease);
        }
      });
      const warning: V2Event = {
        id: "evt_warning",
        created: 4,
        type: "tui.toast.show",
        data: { message: "Native plugin warning", variant: "warning" },
      };
      fixture.channel.push(warning);
      fixture.channel.push(warning);
      if (failure !== "native event") fixture.channel.push({ ...warning, id: "evt_after_failure" });
      try {
        await noticed;
        if (failure === "native event")
          fixture.channel.push({
            id: "evt_wrong",
            created: 5,
            type: "session.idle",
            location: { directory: "/wrong" },
            data: { sessionID: ref.externalSessionId },
          });
        await released;
        expect(signals.filter((signal) => signal.type === "runtime_notice")).toHaveLength(1);
        expect(signals.filter((signal) => signal.type === "fault")).toHaveLength(1);
        if (failure !== "native event")
          expect(signals.at(-1)).toMatchObject({
            type: "fault",
            message: expect.stringContaining("delivery failed"),
          });
      } finally {
        await runtime.release();
      }
    },
  );
  test("rejects startup when buffered signal delivery fails", async () => {
    const fixture = prepareFixture(({ url }) =>
      url.pathname.endsWith("/prompt")
        ? response({
            id: "msg_buffered",
            sessionID: ref.externalSessionId,
            type: "user",
            payload: { text: "Verify startup" },
            delivery: "prompt",
            time: { created: 10 },
          })
        : undefined,
    );
    const runtime = await fixture.prepare();
    const signals: OpencodeSessionRuntimeSignal[] = [];
    const fault = Promise.withResolvers<void>();
    try {
      await runtime.connection.resumeSession({
        ...ref,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository" },
      });
      await runtime.connection.sendUserMessage({
        ...ref,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text: "Verify startup" }],
      });
      await expect(
        runtime.startForwarding((signal) => {
          signals.push(signal);
          if (signal.type === "session_event") throw new Error("Initial delivery failed");
          if (signal.type === "fault") fault.resolve();
        }),
      ).rejects.toThrow("Initial delivery failed");
      await fault.promise;
      expect(signals.map((signal) => signal.type)).toEqual(["session_event", "fault"]);
    } finally {
      await runtime.release();
    }
  });
  test("keeps a bounded transient replay window and ignores unattached session traffic", async () => {
    const fixture = prepareFixture();
    const runtime = await fixture.prepare();
    const notices: string[] = [];
    const statuses: string[] = [];
    let observed = Promise.withResolvers<void>();
    const warning = (id: string, message: string): V2Event => ({
      id,
      created: 4,
      type: "tui.toast.show",
      data: { message, variant: "warning" },
    });
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      await runtime.startForwarding((signal) => {
        if (signal.type === "fault") {
          observed.reject(new Error(signal.message));
        }
        if (signal.type === "runtime_notice") {
          notices.push(signal.message);
          if (
            signal.message === "Unrelated traffic complete" ||
            signal.message === "Attached traffic complete"
          )
            observed.resolve();
        }
        if (signal.type === "session_event" && signal.event.type === "session_status")
          statuses.push(signal.event.status.type);
      });
      const first = warning("evt_first", "First native notice");
      const started: V2Event = {
        id: "evt_started",
        created: 3,
        type: "session.execution.started",
        durable,
        data: { sessionID: ref.externalSessionId },
      };
      fixture.channel.push(started);
      fixture.channel.push(first);
      fixture.channel.push(first);
      for (let index = 0; index < 5_000; index++)
        fixture.channel.push({
          id: `evt_unrelated_${index}`,
          created: 4,
          type: "session.text.delta",
          data: {
            sessionID: "ses_unattached",
            assistantMessageID: "msg_unattached",
            ordinal: 0,
            delta: "x",
          },
        });
      fixture.channel.push(first);
      fixture.channel.push(warning("evt_unrelated_done", "Unrelated traffic complete"));
      await observed.promise;
      expect(notices.filter((message) => message === first.data.message)).toHaveLength(1);
      observed = Promise.withResolvers<void>();
      for (let index = 0; index < 5_000; index++)
        fixture.channel.push(warning(`evt_notice_${index}`, `Native notice ${index}`));
      fixture.channel.push(first);
      fixture.channel.push(warning("evt_notice_4999", "Native notice 4999"));
      fixture.channel.push({ ...started, id: "evt_replayed_start" });
      fixture.channel.push(warning("evt_traffic_done", "Attached traffic complete"));
      await observed.promise;
      expect(notices.filter((message) => message === first.data.message)).toHaveLength(2);
      expect(notices.filter((message) => message === "Native notice 4999")).toHaveLength(1);
      expect(statuses.filter((status) => status === "busy")).toHaveLength(1);
    } finally {
      await runtime.release();
    }
  });
  test("uses the delivered inbox identity and native delivery time", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.apply({
      id: "evt_enqueued",
      created: 10,
      type: "session.inbox.enqueued",
      durable,
      data: {
        sessionID: ref.externalSessionId,
        inboxID: "inbox_1",
        item: { type: "user", payload: { text: "keep" }, delivery: "prompt" },
      },
    });
    const delivered = projector.apply({
      id: "evt_delivered",
      created: 20,
      type: "session.inbox.delivered",
      durable: { ...durable, seq: 2 },
      data: { sessionID: ref.externalSessionId, inboxID: "inbox_1" },
    });
    expect(delivered).toMatchObject([
      {
        type: "user_message",
        messageId: "inbox_1",
        timestamp: new Date(20).toISOString(),
        state: "read",
      },
    ]);
    expect(projectMessage(projector.messages.get("inbox_1")!)).toMatchObject({
      messageId: "inbox_1",
      timestamp: new Date(20).toISOString(),
    });
  });
  test("keeps live part IDs equal to history and does not mark deltas as final messages", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.apply({
      id: "evt_step",
      created: 2,
      type: "session.step.started",
      durable,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_native",
        agent: "build",
        model,
        started: 2,
      },
    });
    projector.apply({
      id: "evt_text",
      created: 3,
      type: "session.text.started",
      durable,
      data: { sessionID: ref.externalSessionId, assistantMessageID: "msg_native", ordinal: 0 },
    });
    const events = projector.apply({
      id: "evt_delta",
      created: 4,
      type: "session.text.delta",
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_native",
        ordinal: 0,
        delta: "Hello",
      },
    });
    expect(events.map((event) => event.type)).toEqual(["assistant_part"]);
    const history = projectMessage(projector.messages.get("msg_native")!);
    expect(history.model).toMatchObject({ profileId: "build" });
    expect(events[0]).toMatchObject({ part: history.parts[0] });
    expect(history.text).toBe("Hello");
  });
  test.each(["text", "reasoning", "tool.input"] as const)(
    "emits only the addressed %s content during preparation, deltas, and completion",
    (kind) => {
      const projector = new OpenCodeLiveMessageProjector();
      projector.seed([
        {
          id: "msg_native",
          type: "assistant",
          agent: "build",
          model,
          time: { created: 2 },
          content: [
            { type: "reasoning", text: "Earlier reasoning.", time: { created: 2, completed: 3 } },
            { type: "text", text: "Earlier text." },
            {
              type: "tool",
              id: "call_earlier",
              name: "read",
              time: { created: 3, ran: 4, completed: 5 },
              state: { status: "completed", input: {}, content: [{ type: "text", text: "File" }] },
            },
          ],
        },
      ]);
      const data = { sessionID: ref.externalSessionId, assistantMessageID: "msg_native" };
      const start = { id: "evt_start", created: 6, durable };
      const delta = { id: "evt_delta", created: 7 };
      const end = { id: "evt_end", created: 8, durable };
      const updates: V2Event[] =
        kind === "text"
          ? [
              { ...start, type: "session.text.started", data: { ...data, ordinal: 1 } },
              {
                ...delta,
                type: "session.text.delta",
                data: { ...data, ordinal: 1, delta: "Next text." },
              },
              {
                ...end,
                type: "session.text.ended",
                data: { ...data, ordinal: 1, text: "Next text." },
              },
            ]
          : kind === "reasoning"
            ? [
                { ...start, type: "session.reasoning.started", data: { ...data, ordinal: 1 } },
                {
                  ...delta,
                  type: "session.reasoning.delta",
                  data: { ...data, ordinal: 1, delta: "Next reasoning." },
                },
                {
                  ...end,
                  type: "session.reasoning.ended",
                  data: { ...data, ordinal: 1, text: "Next reasoning." },
                },
              ]
            : [
                {
                  ...start,
                  type: "session.tool.input.started",
                  data: { ...data, id: "call_next", name: "subagent" },
                },
                {
                  ...delta,
                  type: "session.tool.input.delta",
                  data: { ...data, id: "call_next", delta: '{"agent":"research"}' },
                },
                {
                  ...end,
                  type: "session.tool.input.ended",
                  data: { ...data, id: "call_next", text: '{"agent":"research"}' },
                },
              ];
      const partIds =
        kind === "tool.input" ? ["call_next", "call_next:subagent"] : [`msg_native:${kind}:1`];
      for (const [index, update] of updates.entries()) {
        const events = projector.apply(update);
        expect(events.map((event) => event.type)).toEqual(partIds.map(() => "assistant_part"));
        expect(events.map((event) => event.type === "assistant_part" && event.part.partId)).toEqual(
          partIds,
        );
        expect(events[0]).toMatchObject({
          timestamp: new Date(2).toISOString(),
          part:
            kind === "tool.input"
              ? { status: "pending", inputStreaming: index < 2 }
              : {
                  text: index === 0 ? "" : `Next ${kind}.`,
                  completed: kind === "reasoning" && index === 2,
                },
        });
        if (kind === "tool.input" && index === 2)
          expect(events[0]).toMatchObject({ part: { input: { agent: "research" } } });
      }
      const restored = projector.snapshotEvents(ref.externalSessionId);
      expect(restored.map((event) => event.type === "assistant_part" && event.part.partId)).toEqual(
        ["msg_native:reasoning:0", "msg_native:text:0", "call_earlier", ...partIds],
      );
      expect(restored.slice(0, 3)).toMatchObject([
        { part: { text: "Earlier reasoning.", completed: true } },
        { part: { text: "Earlier text." } },
        { part: { status: "completed", output: "File" } },
      ]);
    },
  );
  test.each(["tool-calls", "stop"])(
    "uses native %s finality consistently in live output and hydrated history",
    (finish) => {
      const projector = new OpenCodeLiveMessageProjector();
      projector.seed([
        {
          id: "msg_native",
          type: "assistant",
          agent: "build",
          model,
          time: { created: 2 },
          content: [
            { type: "reasoning", text: "Source review.", time: { created: 2, completed: 3 } },
            { type: "text", text: "Checking the source." },
          ],
        },
      ]);
      const events = projector.apply({
        id: "evt_end",
        type: "session.step.ended",
        created: 5,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: "msg_native",
          finish,
          cost: 0,
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      });
      expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(
        finish === "stop" ? 1 : 0,
      );
      expect(
        events.flatMap((event) => (event.type === "assistant_part" ? [event.part.partId] : [])),
      ).toEqual(["msg_native:reasoning:0", "msg_native:text:0", "msg_native:finish"]);
      const history = projectMessage(projector.messages.get("msg_native")!);
      expect(history.model).toMatchObject({ profileId: "build" });
      if (finish === "stop")
        expect(events).toContainEqual(
          expect.objectContaining({ type: "assistant_message", model: history.model }),
        );
      expect(history.parts).toContainEqual(
        expect.objectContaining({ kind: "step", phase: "finish", reason: finish }),
      );
    },
  );
  test.each(["aborted", "provider.error"])(
    "classifies native %s steps by type in live output and history",
    (type) => {
      const projector = new OpenCodeLiveMessageProjector();
      projector.seed([
        {
          id: "msg_native",
          type: "assistant",
          agent: "build",
          model,
          time: { created: 10 },
          content: [
            {
              type: "tool",
              id: "call_question",
              name: "question",
              time: { created: 11, ran: 12 },
              state: { status: "running", input: { questions: [] }, metadata: {} },
            },
          ],
        },
      ]);
      projector.apply({
        id: "evt_tool_failed",
        type: "session.tool.failed",
        created: 20,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: "msg_native",
          id: "call_question",
          error: { type, message: "Tool execution interrupted" },
        },
      });
      const events = projector.apply({
        id: "evt_step_failed",
        type: "session.step.failed",
        created: 21,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: "msg_native",
          error: { type, message: "Step interrupted" },
        },
      });
      const history = projectMessages([...projector.messages.values()]);
      expect(history[0]?.parts).toContainEqual(
        expect.objectContaining({
          kind: "tool",
          status: "error",
          error: "Tool execution interrupted",
        }),
      );
      expect(events.filter((event) => event.type === "turn_error")).toHaveLength(
        type === "aborted" ? 0 : 1,
      );
      expect(history[0]?.error).toBe(type === "aborted" ? undefined : "Step interrupted");
    },
  );
  test.each([
    {
      event: {
        id: "evt_terminal",
        type: "session.execution.succeeded",
        created: 40,
        durable,
        data: { sessionID: ref.externalSessionId },
      } satisfies V2Event,
      outcome: "succeeded",
      notice: "Turn completed.",
    },
    {
      event: {
        id: "evt_terminal",
        type: "session.execution.failed",
        created: 40,
        durable,
        data: { sessionID: ref.externalSessionId, error: { message: "Provider failed" } },
      } satisfies V2Event,
      outcome: "failed",
      notice: "Turn failed.",
    },
    {
      event: {
        id: "evt_terminal",
        type: "session.execution.interrupted",
        created: 40,
        durable,
        data: { sessionID: ref.externalSessionId, reason: "user" },
      } satisfies V2Event,
      outcome: "interrupted",
      notice: "Turn interrupted.",
    },
  ])(
    "keeps terminal state and a single native notice for $outcome",
    ({ event, outcome, notice }) => {
      const projector = new OpenCodeLiveMessageProjector();
      const events = projector.apply(event);
      expect(events.filter((item) => item.type === "session_policy_notice")).toEqual(
        outcome !== "failed"
          ? []
          : [
              {
                type: "session_policy_notice",
                externalSessionId: ref.externalSessionId,
                messageId: "msg_terminal",
                timestamp: new Date(40).toISOString(),
                message: notice,
              },
            ],
      );
      const expectedHistory: AgentSessionHistoryMessage[] =
        outcome === "succeeded"
          ? []
          : [
              {
                messageId: "msg_terminal",
                timestamp: new Date(40).toISOString(),
                role: "system",
                text: notice,
                parts: [],
              },
            ];
      if (outcome === "interrupted")
        expectedHistory[0]!.notice = {
          tone: "cancelled",
          reason: "session_interrupted",
          title: "Interrupted",
        };
      expect(projectMessages([...projector.messages.values()])).toEqual(expectedHistory);
      const idle = events.find((item) => item.type === "session_idle");
      expect(idle).toMatchObject({
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: new Date(40).toISOString(),
      });
      expect(idle?.turnCompleted).toBe(outcome === "succeeded" ? true : undefined);
      if (outcome === "interrupted")
        expect(idle).toMatchObject({
          interruption: { messageId: "msg_terminal", message: notice },
        });
      if (outcome === "failed")
        expect(events.find((item) => item.type === "turn_error")).toMatchObject({
          message: "Provider failed",
        });
    },
  );
  test("keeps native shutdown interruption resumable without a terminal notice", () => {
    const projector = new OpenCodeLiveMessageProjector();
    expect(
      projector.apply({
        id: "evt_shutdown",
        type: "session.execution.interrupted",
        created: 40,
        durable,
        data: { sessionID: ref.externalSessionId, reason: "shutdown" },
      }),
    ).toEqual([]);
    expect([...projector.messages.values()]).toEqual([]);
  });
  test("retains native profile selection without adding a chat notice", () => {
    const projector = new OpenCodeLiveMessageProjector();
    expect(
      projector.apply({
        id: "evt_profile",
        type: "session.agent.selected",
        created: 3,
        durable,
        data: { sessionID: ref.externalSessionId, agent: "build" },
      }),
    ).toEqual([]);
    expect(projector.messages.get("msg_profile")).toMatchObject({
      type: "agent-switched",
      agent: "build",
    });
    expect(projectMessages([...projector.messages.values()])).toEqual([]);
  });
  test("preserves tool preparation and execution timing in live events and history", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.seed([
      {
        id: "msg_native",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 2 },
        content: [
          { type: "reasoning", text: "Prepare the plan.", time: { created: 2, completed: 3 } },
        ],
      },
    ]);
    const started = projector.apply({
      id: "evt_input",
      type: "session.tool.input.started",
      created: 3,
      durable,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_native",
        id: "call_plan",
        name: "openducktor_odt_set_plan",
      },
    });
    const preparing = projectMessage(projector.messages.get("msg_native")!).parts[1]!;
    expect(preparing).toMatchObject({ kind: "tool", status: "pending", inputStreaming: true });
    expect(preparing).not.toHaveProperty("startedAtMs");
    expect(started[0]).toMatchObject({ part: preparing });

    const inputText = JSON.stringify({ taskId: "task-1", markdown: "# Plan" });
    const delta = projector.apply({
      id: "evt_delta",
      type: "session.tool.input.delta",
      created: 4,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_native",
        id: "call_plan",
        delta: inputText.slice(0, 10),
      },
    });
    expect(delta[0]).toMatchObject({ part: { inputStreaming: true, status: "pending" } });
    const ended = projector.apply({
      id: "evt_ended",
      type: "session.tool.input.ended",
      created: 5,
      durable,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_native",
        id: "call_plan",
        text: inputText,
      },
    });
    const queued = projectMessage(projector.messages.get("msg_native")!).parts[1]!;
    expect(queued).toMatchObject({
      status: "pending",
      inputStreaming: false,
      input: { taskId: "task-1", markdown: "# Plan" },
    });
    expect(queued).not.toHaveProperty("startedAtMs");
    expect(ended[0]).toMatchObject({ part: queued });

    for (const event of [
      {
        id: "evt_called",
        type: "session.tool.called",
        created: 50,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: "msg_native",
          id: "call_plan",
          input: { taskId: "task-1", markdown: "# Plan" },
          executed: false,
        },
      },
      {
        id: "evt_success",
        type: "session.tool.success",
        created: 60,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          assistantMessageID: "msg_native",
          id: "call_plan",
          content: [{ type: "text", text: "Plan saved" }],
          executed: false,
        },
      },
    ] satisfies V2Event[]) {
      const events = projector.apply(event);
      const part = projectMessage(projector.messages.get("msg_native")!).parts[1]!;
      expect(part).not.toHaveProperty("inputStreaming");
      expect(part).toMatchObject({
        startedAtMs: 50,
        input: { taskId: "task-1", markdown: "# Plan" },
      });
      expect(events).toMatchObject([
        { part: { kind: "reasoning", text: "Prepare the plan.", completed: true } },
        { part },
      ]);
    }
    expect(projectMessage(projector.messages.get("msg_native")!).parts[1]).toMatchObject({
      status: "completed",
      endedAtMs: 60,
    });
  });

  test("keeps native instruction updates collapsed and identical after hydration", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const text = "The Code Mode tool catalog has changed.\nNew tools are available.";
    const events = projector.apply({
      id: "evt_instructions",
      type: "session.instructions.updated",
      created: 3,
      durable: { ...durable, version: 2 },
      data: { sessionID: ref.externalSessionId, delta: { "core/codemode": "Tool catalog" }, text },
    });
    const saved: SessionMessageInfo = {
      id: "msg_instructions",
      type: "system",
      time: { created: 3 },
      text,
      metadata: { notice: "instructions", instructionSources: ["core/codemode"] },
      description: "Instructions updated: core/codemode",
    };
    expect(projectMessage(saved).text).toBe(`Instructions update:\n\n${text}`);
    expect(events).toEqual([
      {
        type: "session_policy_notice",
        externalSessionId: ref.externalSessionId,
        timestamp: new Date(3).toISOString(),
        messageId: saved.id,
        message: projectMessage(saved).text,
      },
    ]);
    expect(projectMessage(projector.messages.get(saved.id)!)).toEqual(projectMessage(saved));
  });

  test("measures the whole native turn across tool steps in live events and history", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.seed([
      {
        id: "msg_previous",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 1, completed: 3 },
        finish: "stop",
        content: [],
      },
      { id: "msg_idle", type: "idle", time: { created: 4 }, outcome: "succeeded" },
      {
        id: "msg_tool_step",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 10, completed: 20 },
        finish: "tool-calls",
        content: [],
      },
      {
        id: "msg_final",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 25 },
        content: [{ type: "text", text: "Plan saved." }],
      },
    ]);
    const events = projector.apply({
      id: "evt_end",
      type: "session.step.ended",
      created: 40,
      durable,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_final",
        finish: "stop",
        cost: 0,
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    });
    expect(events.find((event) => event.type === "assistant_message")).toMatchObject({
      durationMs: 30,
    });
    const history = projectMessages([...projector.messages.values()]);
    expect(history.find((message) => message.messageId === "msg_final")).toMatchObject({
      durationMs: 30,
    });
    expect(history.find((message) => message.messageId === "msg_tool_step")).not.toHaveProperty(
      "durationMs",
    );
  });

  test("updates manual compaction under the native input ID in live events and history", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const start = projector.apply({
      id: "evt_compact_start",
      created: 4,
      type: "session.compaction.started",
      durable,
      data: {
        sessionID: ref.externalSessionId,
        inputID: "msg_compact",
        reason: "manual",
        recent: "Recent",
      },
    });
    const end = projector.apply({
      id: "evt_compact_end",
      created: 5,
      type: "session.compaction.ended",
      durable: { ...durable, seq: 2 },
      data: {
        sessionID: ref.externalSessionId,
        reason: "manual",
        text: "Summary",
        recent: "Recent",
      },
    });
    expect(start).toMatchObject([{ type: "session_compaction_started", messageId: "msg_compact" }]);
    expect(end).toMatchObject([
      { type: "session_compacted", messageId: "msg_compact", message: "Summary\nRecent" },
    ]);
    expect([...projector.messages.keys()]).toEqual(["msg_compact"]);
    expect(projectMessage(projector.messages.get("msg_compact")!)).toMatchObject({
      messageId: "msg_compact",
      text: "Summary\nRecent",
      notice: { reason: "session_compacted" },
    });
  });
  test("retains open text and tool progress when native snapshots omit ephemeral updates", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const snapshot: SessionMessageInfo = {
      id: "msg_native",
      type: "assistant",
      time: { created: 2 },
      agent: "build",
      model,
      content: [
        { type: "text", text: "" },
        {
          type: "tool",
          id: "call_native",
          name: "read",
          time: { created: 2, ran: 3 },
          state: { status: "running", input: {}, metadata: {} },
        },
      ],
    };
    projector.seed([snapshot]);
    projector.apply({
      id: "evt_delta",
      created: 3,
      type: "session.text.delta",
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: snapshot.id,
        ordinal: 0,
        delta: "Hello",
      },
    });
    projector.apply({
      id: "evt_progress",
      created: 4,
      type: "session.tool.progress",
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: snapshot.id,
        id: "call_native",
        metadata: { title: "Opening file" },
      },
    });
    projector.seed([snapshot]);
    const events = projector.apply({
      id: "evt_delta_next",
      created: 5,
      type: "session.text.delta",
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: snapshot.id,
        ordinal: 0,
        delta: " world",
      },
    });
    expect(events).toMatchObject([{ part: { kind: "text", text: "Hello world" } }]);
    expect(events).toHaveLength(1);
    expect(projector.snapshotEvents(ref.externalSessionId)).toMatchObject([
      { part: { kind: "text", text: "Hello world" } },
      { part: { kind: "tool", status: "running", metadata: { title: "Opening file" } } },
    ]);
  });
  test("keeps background subagents running until structured native completion", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const message = backgroundLaunch();
    projector.seed([message]);
    expect(projectMessage(message).parts[1]).toMatchObject({
      kind: "subagent",
      status: "running",
      executionMode: "background",
      externalSessionId: "ses_child",
    });
    expect(projectMessage(message).parts[1]).not.toHaveProperty("endedAtMs");
    expect(
      projector.apply({
        id: "evt_child_complete",
        created: 9,
        type: "session.inbox.enqueued",
        durable,
        data: {
          sessionID: ref.externalSessionId,
          inboxID: "msg_child_complete",
          item: {
            type: "synthetic",
            delivery: "steer",
            payload: {
              text: "Native child result",
              description: "Research completed",
              metadata: {
                source: "subagent",
                childID: "ses_child",
                agent: "research",
                state: "completed",
              },
            },
          },
        },
      }),
    ).toEqual([]);
    const delivery: V2Event = {
      id: "evt_child_delivered",
      type: "session.inbox.delivered",
      created: 10,
      durable: { ...durable, seq: 2 },
      data: { sessionID: ref.externalSessionId, inboxID: "msg_child_complete" },
    };
    const events = projector.apply(delivery);
    expect(events).toContainEqual({
      type: "session_policy_notice",
      externalSessionId: ref.externalSessionId,
      timestamp: new Date(10).toISOString(),
      messageId: "msg_child_complete",
      message: "Native child result",
    });
    const completed = events.find((event) => event.type === "assistant_part");
    expect(completed).toMatchObject({
      part: { partId: "call_child:subagent", status: "completed", endedAtMs: 10 },
    });
    expect(projectMessages([...projector.messages.values()])[0]?.parts[1]).toMatchObject({
      status: "completed",
      endedAtMs: 10,
    });
    expect(projectMessages([...projector.messages.values()])[1]).toMatchObject({
      messageId: "msg_child_complete",
      role: "system",
      text: "Native child result",
    });
    expect(projector.apply(delivery)).toEqual([]);
    expect(projector.messages).toHaveProperty("size", 2);
  });
  test("rebuilds child completion state after reversion and reseeding", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const launch = backgroundLaunch();
    const completion: SessionMessageInfo = {
      id: "msg_child_completion",
      type: "synthetic",
      time: { created: 9 },
      text: "Research completed",
      metadata: { source: "subagent", childID: "ses_child", state: "completed" },
    };
    const child = () =>
      projector
        .snapshotEvents(ref.externalSessionId)
        .find((event) => event.type === "assistant_part" && event.part.kind === "subagent");
    projector.seed([launch, completion]);
    expect(child()).toMatchObject({ part: { status: "completed", endedAtMs: 9 } });
    projector.apply({
      id: "evt_revert_child_completion",
      type: "session.revert.committed",
      created: 10,
      durable,
      data: { sessionID: ref.externalSessionId, to: completion.id },
    });
    expect(child()).toMatchObject({ part: { status: "running" } });
    expect(child()).not.toHaveProperty("part.endedAtMs");
    projector.seed([launch, completion]);
    expect(child()).toMatchObject({ part: { status: "completed", endedAtMs: 9 } });
  });
  test("cancels an owned source read before release waits for observation", async () => {
    const started = Promise.withResolvers<void>();
    let aborted = false;
    const fixture = prepareFixture(({ url, signal }) => {
      if (!url.pathname.endsWith("/message")) return undefined;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) throw new Error("Expected runtime-owned cancellation");
        started.resolve();
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });
    const runtime = await fixture.prepare();
    const reading = runtime.connection.readSessionSources(ref.repoPath, [
      { ...ref, sessionScope: { kind: "repository" } },
    ]);
    await started.promise;
    await runtime.release();
    expect(aborted).toBe(true);
    expect((await reading).failures).toHaveLength(1);
  });
  test("keeps completion results separate when the same child conversation is continued", () => {
    const launch = (id: string, at: number): SessionMessageInfo => ({
      id,
      type: "assistant",
      time: { created: at, completed: at + 2 },
      agent: "build",
      model,
      content: [
        {
          type: "tool",
          id: `call_${id}`,
          name: "subagent",
          time: { created: at, ran: at + 1, completed: at + 2 },
          state: {
            status: "completed",
            input: { background: true, sessionID: "ses_child" },
            content: [{ type: "text", text: "Started" }],
            metadata: { sessionID: "ses_child", status: "running" },
          },
        },
      ],
    });
    const completion = (
      id: string,
      at: number,
      state: "error" | "completed" | "cancelled",
    ): SessionMessageInfo => ({
      id,
      type: "synthetic",
      time: { created: at },
      text: `Native ${state} result`,
      metadata: { source: "subagent", childID: "ses_child", state },
    });
    const history = projectMessages([
      launch("first", 1),
      completion("failed", 5, "error"),
      launch("second", 7),
      completion("done", 12, "completed"),
      launch("third", 14),
      completion("cancelled", 18, "cancelled"),
    ]);
    expect(
      history.filter((message) => message.role === "assistant").map((message) => message.parts[1]),
    ).toMatchObject([
      { status: "error", endedAtMs: 5 },
      { status: "completed", endedAtMs: 12 },
      { status: "cancelled", endedAtMs: 18 },
    ]);
  });
});

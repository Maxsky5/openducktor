import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import type { SessionInfo, SessionMessageInfo, SessionInboxUser } from "@opencode/client";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import { OpenCodeOperationError } from "./opencode-client";
import { OpenCodeMessageRejectedError } from "./opencode-message-rejected-error";
import {
  compilePermissionRule,
  compileCreationSettings,
  forkNativePermissions,
  ownedWorkflowRole,
} from "./opencode-permissions";
import {
  createController,
  ref,
  session,
  response,
  noContent,
  cursorPage,
  location,
  model,
  nativeClient,
} from "./opencode-v2.test-support";

const repository = {
  ...ref,
  runtimePolicy: { kind: "opencode" as const },
  sessionScope: { kind: "repository" as const },
};
const workflow = {
  ...ref,
  runtimePolicy: { kind: "opencode" as const },
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "spec" as const },
  systemPrompt: "Full workflow instructions. Read this task and use only allowed tools.",
};
const current = session({
  permissions: [{ action: "read", resource: "notes/**", effect: "ask" }],
  metadata: { native: "retained" },
});

describe("OpenCode V2 conversation identity and history", () => {
  test.each([
    { speed: "fast", outcome: "reject" },
    { speed: undefined, outcome: "accept" },
  ])("$outcome model speed $speed at the native boundary", async ({ speed, outcome }) => {
    const { controller, requests } = createController(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (method === "GET" && url.pathname === "/api/session/ses_saved") return response(current);
      if (method === "POST" && url.pathname.endsWith("/model")) return noContent();
      throw new Error(`Unexpected model request ${method} ${url.pathname}`);
    });
    const failure = await controller
      .updateSessionModel({ ...ref, model: { providerId: "test", modelId: "test-model", speed } })
      .catch((cause: unknown) => cause);
    const modelRequests = requests.filter(({ url }) => url.pathname.endsWith("/model"));
    if (outcome === "reject") {
      expect(failure).toBeInstanceOf(OpenCodeOperationError);
      expect(failure).toMatchObject({
        message: expect.stringContaining(
          "OpenCode does not support speed 'fast'. Select standard speed.",
        ),
      });
      expect(modelRequests).toEqual([]);
    } else {
      expect(failure).toBeUndefined();
      expect(modelRequests).toHaveLength(1);
      expect(modelRequests[0]?.body).toEqual({ model });
    }
  });

  test("reads installed workflow instructions separately from later native updates", async () => {
    const installedPrompt = "You are the OpenDucktor Builder for task-1. Use odt_build_completed.";
    const messages: SessionMessageInfo[] = [
      { id: "msg_user", type: "user", text: "Implement this task.", time: { created: 2 } },
      {
        id: "msg_catalog",
        type: "system",
        text: "The Code Mode tool catalog has changed.",
        description: "Instructions updated: core/codemode",
        metadata: { notice: "instructions", instructionSources: ["core/codemode"] },
        time: { created: 3 },
      },
    ];
    const { controller, requests } = createController(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/ses_saved") return response(current);
      if (url.pathname.endsWith("/message")) return cursorPage(messages);
      if (url.pathname.endsWith("/instructions/entries"))
        return response([
          { key: "user.context", value: "Unrelated native instructions." },
          { key: "openducktor.workflow", value: installedPrompt },
        ]);
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    });
    const history = await controller.loadSessionHistory({
      ...ref,
      systemPromptContext: {
        systemPrompt: "New settings that were never installed.",
        startedAt: "2026-01-01T00:00:00Z",
      },
    });
    expect(history[0]).toMatchObject({
      role: "system",
      text: `System prompt:\n\n${installedPrompt}`,
      timestamp: new Date(current.time.created).toISOString(),
    });
    expect(history.filter((item) => item.text.startsWith("System prompt:\n\n"))).toHaveLength(1);
    expect(history[1]?.messageId).toBe("msg_user");
    expect(history[2]).toMatchObject({
      messageId: "msg_catalog",
      text: "Instructions update:\n\nThe Code Mode tool catalog has changed.",
    });
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });

  test.each([
    { label: "malformed", value: 42 },
    { label: "empty", value: " " },
    { label: "unavailable", value: undefined },
  ])("reports $label stored instructions without inventing a prompt", async ({ value }) => {
    const { controller, requests } = createController(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/ses_saved") return response(current);
      if (url.pathname.endsWith("/message")) return cursorPage([]);
      if (url.pathname.endsWith("/instructions/entries"))
        return value === undefined
          ? Response.json({ message: "Instruction read failed" }, { status: 503 })
          : response([{ key: "openducktor.workflow", value }]);
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    });
    const failure = await controller.loadSessionHistory(ref).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(OpenCodeOperationError);
    if (!(failure instanceof OpenCodeOperationError)) throw new Error("Expected history failure");
    expect(failure.failure.runtimeOperationFailure).toMatchObject({
      operation: "read history",
      externalSessionId: ref.externalSessionId,
      nativeReason: expect.any(String),
    });
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });

  test.each([
    { label: "missing skill name", skills: [{ id: "skill_native_review", text: "Retain this." }] },
    {
      label: "invalid skill text",
      skills: [{ id: "skill_native_review", name: "review", text: 42 }],
    },
    { label: "invalid skills list", skills: null },
    { label: "empty skill ID", skills: [{ id: "", name: "review" }] },
    { label: "empty skill name", skills: [{ id: "skill_native_review", name: "" }] },
    {
      label: "invalid skill mention",
      skills: [{ id: "skill_native_review", name: "review", mention: null }],
    },
  ])("fails a history read for $label instead of dropping content", async ({ skills }) => {
    const { controller, requests } = createController(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/ses_saved") return response(current);
      if (url.pathname.endsWith("/instructions/entries")) return response([]);
      if (url.pathname.endsWith("/message"))
        return cursorPage([
          { id: "msg_invalid", type: "user", time: { created: 8 }, text: "Use @review", skills },
        ]);
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    });
    const failure = await controller.loadSessionHistory(ref).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(OpenCodeOperationError);
    if (!(failure instanceof OpenCodeOperationError)) throw new Error("Expected history failure");
    expect(failure.failure.runtimeOperationFailure).toMatchObject({
      code: "invalid_runtime_response",
      operation: "read history",
      externalSessionId: ref.externalSessionId,
      nativeReason: expect.any(String),
      nextAction: expect.any(String),
    });
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });

  test("preserves typed prompt references in acceptance and reopened history", async () => {
    const directory = process.platform === "win32" ? "D:\\repo\\src" : "/repo/src";
    const file = process.platform === "win32" ? "D:\\repo\\src\\main.ts" : "/repo/src/main.ts";
    const text =
      "@research @src/main.ts @src\n[Attachment unavailable after migration: old.png (image/png)]\n@review";
    const payload: SessionInboxUser["payload"] = {
      text,
      agents: [{ name: "research", mention: { text: "@research", start: 0, end: 9 } }],
      skills: [
        {
          id: "skill_native_review",
          name: "review",
          text: "<skill_content>Check the native contract.\nKeep supplied text.</skill_content>",
          mention: { text: "@review", start: text.length - 7, end: text.length },
        },
        { id: "skill_native_review", name: "review" },
        { id: "skill_native_empty", name: "empty", text: "" },
      ],
      files: [
        {
          source: { type: "uri", uri: pathToFileURL(file).href },
          data: "Y29uc3QgdmFsdWUgPSAxOw==",
          mime: "text/plain",
          name: "main.ts",
          mention: { text: "@src/main.ts", start: 10, end: 22 },
        },
        {
          source: { type: "uri", uri: pathToFileURL(directory).href },
          data: "bWFpbi50cw==",
          mime: "application/x-directory",
          name: "src",
          mention: { text: "@src", start: 23, end: 27 },
        },
        {
          source: { type: "inline" },
          data: "aW1hZ2U=",
          mime: "image/png",
          name: "capture.png",
        },
      ],
    };
    const { controller, requests } = createController(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (method === "PATCH") return noContent();
      if (url.pathname === "/api/session/ses_saved") return response(current);
      if (url.pathname.endsWith("/instructions/entries")) return response([]);
      if (url.pathname.endsWith("/message"))
        return cursorPage([{ id: "msg_prompt", type: "user", time: { created: 8 }, ...payload }]);
      if (url.pathname.endsWith("/prompt"))
        return response({
          id: "msg_prompt",
          sessionID: ref.externalSessionId,
          type: "user",
          payload,
          delivery: "prompt",
          time: { created: 8 },
        });
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    });
    const accepted = await controller.sendUserMessage({
      ...repository,
      parts: [{ kind: "text", text }],
    });
    if (accepted.type !== "user_message") throw new Error("Expected an accepted user prompt");
    const historyRequestStart = requests.length;
    const history = await controller.loadSessionHistory(ref);
    expect(requests.slice(historyRequestStart).every(({ method }) => method === "GET")).toBe(true);
    for (const parts of [accepted.parts, history[0]?.displayParts]) {
      expect(parts).toContainEqual({
        kind: "text",
        text,
      });
      expect(parts).toContainEqual({
        kind: "subagent_reference",
        subagent: { id: "research", name: "research" },
        sourceText: { value: "@research", start: 0, end: 9 },
      });
      expect(parts).toContainEqual({
        kind: "skill_mention",
        skill: {
          id: "skill_native_review",
          name: "review",
          path: "skill_native_review",
        },
        sourceText: { value: "@review", start: text.length - 7, end: text.length },
      });
      expect(parts).toContainEqual({
        kind: "skill_mention",
        skill: { id: "skill_native_review", name: "review", path: "skill_native_review" },
      });
      expect(parts).toContainEqual({
        kind: "skill_mention",
        skill: { id: "skill_native_empty", name: "empty", path: "skill_native_empty" },
      });
      expect(parts).toContainEqual({
        kind: "file_reference",
        file: { id: file, path: file, name: "main.ts", kind: "code" },
        sourceText: { value: "@src/main.ts", start: 10, end: 22 },
      });
      expect(parts).toContainEqual({
        kind: "file_reference",
        file: { id: directory, path: directory, name: "src", kind: "directory" },
        sourceText: { value: "@src", start: 23, end: 27 },
      });
      expect(parts).toContainEqual({
        kind: "attachment",
        attachment: {
          id: "msg_prompt:attachment:2",
          path: "data:image/png;base64,aW1hZ2U=",
          name: "capture.png",
          kind: "image",
          mime: "image/png",
        },
      });
    }
  });
  test("reads all ascending pages without mutations and retains native content and failures", async () => {
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_user",
        type: "user",
        time: { created: 3 },
        text: "Original prompt",
        files: [{ data: "", source: { type: "inline" }, mime: "image/png", name: "old.png" }],
      },
      {
        id: "msg_assistant",
        type: "assistant",
        time: { created: 4, completed: 5 },
        agent: "build",
        model,
        error: { message: "Interrupted native step" },
        content: [
          { type: "reasoning", text: "Retained reasoning" },
          { type: "text", text: "Retained text" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            time: { created: 4, completed: 5 },
            state: {
              status: "error",
              input: { file: "a.txt" },
              error: { message: "Native tool failure" },
              content: [
                { type: "text", text: "partial result" },
                { type: "file", uri: "file:///repo/a.txt", mime: "text/plain", name: "a.txt" },
              ],
            },
          },
        ],
      },
      {
        id: "msg_shell",
        type: "shell",
        shellID: "shell_1",
        time: { created: 6 },
        command: "bun test",
        status: "exited",
        exit: 0,
        output: { output: "Passed", cursor: 1, size: 6, truncated: true },
      },
    ];
    const { controller, requests } = createController(({ url }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/ses_saved") return response(current);
      if (url.pathname.endsWith("/instructions/entries")) return response([]);
      if (url.pathname.endsWith("/message"))
        return cursorPage(
          url.searchParams.has("cursor") ? messages.slice(1) : messages.slice(0, 1),
          url.searchParams.has("cursor") ? null : "page-2",
        );
      throw new Error(`Unexpected history request ${url.pathname}`);
    });
    const history = await controller.loadSessionHistory(ref);
    expect(history.map((item) => item.messageId)).toEqual([
      "msg_user",
      "msg_assistant",
      "msg_shell",
    ]);
    expect(history[0]).toMatchObject({
      displayParts: [
        { kind: "text", text: "Original prompt" },
        {
          kind: "attachment",
          attachment: {
            id: "msg_user:attachment:0",
            name: "old.png",
            path: "data:image/png;base64,",
            kind: "image",
            mime: "image/png",
          },
        },
      ],
    });
    expect(history[1]).toMatchObject({
      error: "Interrupted native step",
      parts: [
        { kind: "reasoning", text: "Retained reasoning" },
        { kind: "text", text: "Retained text" },
        {
          kind: "tool",
          partId: "call_1",
          error: "Native tool failure",
          resultContent: [
            { kind: "text", text: "partial result" },
            { kind: "file", file: { uri: "file:///repo/a.txt" } },
          ],
        },
      ],
    });
    expect(history[2]?.text).toContain("Native output was truncated.");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests
        .filter((request) => request.url.pathname.endsWith("/message"))
        .map((request) => Object.fromEntries(request.url.searchParams)),
    ).toEqual([
      { limit: "100", order: "asc" },
      { limit: "100", cursor: "page-2" },
    ]);
  });
  for (const migration of [
    { status: "required" },
    { status: "running", progress: { label: "Messages", numerator: 2, denominator: 5 } },
    { status: "error", error: "Native migration failed" },
  ] as const) {
    test(`keeps saved links unchanged when migration is ${migration.status}`, async () => {
      const { controller, requests } = createController(() => Response.json(migration));
      const failure = await controller.loadSessionHistory(ref).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(OpenCodeOperationError);
      if (!(failure instanceof OpenCodeOperationError))
        throw new Error("Expected migration failure");
      expect(failure.failure.runtimeOperationFailure).toMatchObject({
        code: "migration_blocked",
        externalSessionId: "ses_saved",
        migration,
      });
      expect(requests).toHaveLength(1);
    });
  }
  for (const detail of [
    session({ id: "ses_other" }),
    session({ location: { directory: "/other" } }),
  ]) {
    test(`blocks mismatched native identity ${detail.id}:${detail.location.directory}`, async () => {
      const { controller, requests } = createController(({ url }) =>
        url.pathname.endsWith("/migration/v1")
          ? Response.json({ status: "completed" })
          : response(detail),
      );
      await expect(controller.resumeSession(workflow)).rejects.toThrow(
        "saved association is unchanged",
      );
      expect(requests.every((request) => request.method === "GET")).toBe(true);
    });
  }
});

describe("OpenCode V2 controls and accepted input", () => {
  test.each(["policy", "prompt", "command"] as const)(
    "preserves rejection evidence when %s fails",
    async (stage) => {
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if ((stage === "policy" && method === "PATCH") || url.pathname.endsWith(`/${stage}`))
          return Response.json({ message: "Native request failed" }, { status: 503 });
        if (method === "PATCH" || method === "PUT") return noContent();
        if (url.pathname === "/api/session/ses_saved") return response(current);
        throw new Error(`Unexpected request ${method} ${url.pathname}`);
      });
      const failure = await controller
        .sendUserMessage({
          ...repository,
          parts:
            stage === "command"
              ? [
                  {
                    kind: "slash_command",
                    command: { id: "review", trigger: "review", title: "Review", hints: [] },
                  },
                ]
              : [{ kind: "text", text: "First instruction" }],
        })
        .catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({
        failure: {
          kind: "runtime_operation",
          runtimeOperationFailure: {
            code: "request_failed",
            externalSessionId: ref.externalSessionId,
          },
        },
      });
      expect(failure instanceof OpenCodeMessageRejectedError).toBe(stage === "policy");
      expect(requests.some(({ url }) => /\/(prompt|command)$/.test(url.pathname))).toBe(
        stage !== "policy",
      );
    },
  );

  test.each(["prompt", "command"] as const)(
    "rejects workflow subagent references before native %s preparation",
    async (mode) => {
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (method === "PATCH" || method === "PUT" || url.pathname.endsWith("/command"))
          return noContent();
        if (url.pathname === "/api/session/ses_saved") return response(current);
        throw new Error(`Unexpected input request ${method} ${url.pathname}`);
      });
      let submitted = false;
      const failure = await controller
        .sendUserMessage(
          {
            ...workflow,
            parts: [
              ...(mode === "command"
                ? [
                    {
                      kind: "slash_command" as const,
                      command: { id: "review", trigger: "review", title: "Review", hints: [] },
                    },
                  ]
                : []),
              { kind: "text", text: "Ask " },
              {
                kind: "subagent_reference",
                subagent: { id: "research", name: "research" },
                sourceText: { value: "@research", start: 4, end: 13 },
              },
            ],
          },
          { onSent: () => (submitted = true) },
        )
        .catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(OpenCodeMessageRejectedError);
      expect(failure).toMatchObject({
        failure: {
          kind: "runtime_operation",
          runtimeOperationFailure: {
            code: "unsupported_operation",
            externalSessionId: ref.externalSessionId,
          },
        },
      });
      expect(submitted).toBe(false);
      expect(requests).toHaveLength(0);
    },
  );

  test.each([
    { label: "workspace", scope: repository.sessionScope },
    ...(["spec", "planner", "build", "qa"] as const).map((role) => ({
      label: role,
      scope: { ...workflow.sessionScope, role },
    })),
  ])("runs custom slash commands in $label conversations", async ({ scope }) => {
    const { controller, requests } = createController(({ url, method }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (method === "PATCH" || method === "PUT" || url.pathname.endsWith("/command"))
        return noContent();
      if (url.pathname === "/api/session/ses_saved") return response(current);
      throw new Error(`Unexpected command request ${method} ${url.pathname}`);
    });
    const accepted = await controller.sendUserMessage({
      ...workflow,
      sessionScope: scope,
      parts: [
        {
          kind: "slash_command",
          command: { id: "review", trigger: "review", title: "Review", hints: [] },
        },
        { kind: "text", text: "--staged " },
        ...(scope.kind === "repository"
          ? [
              {
                kind: "subagent_reference" as const,
                subagent: { id: "research", name: "research" },
                sourceText: { value: "@research", start: 9, end: 18 },
              },
              { kind: "text" as const, text: " " },
            ]
          : []),
        { kind: "text", text: "Keep these arguments" },
      ],
    });
    expect(accepted).toEqual({ type: "command_accepted", commandName: "review" });
    const commandRequest = requests.find(({ url }) => url.pathname.endsWith("/command"));
    expect(commandRequest?.url.pathname).toBe(`/api/session/${ref.externalSessionId}/command`);
    expect(commandRequest?.body).toEqual(
      scope.kind === "repository"
        ? {
            name: "review",
            text: "--staged @research Keep these arguments",
            agents: [{ name: "research", mention: { text: "@research", start: 9, end: 18 } }],
          }
        : { name: "review", text: "--staged Keep these arguments" },
    );
    expect(requests.some(({ url }) => url.pathname.endsWith("/prompt"))).toBe(false);
  });

  test.each(
    (["start", "fork"] as const).flatMap((operation) =>
      (
        ["confirmation", "directory", "metadata", "invalid_id", "missing_id", "cleanup"] as const
      ).map((stage) => ({ operation, stage })),
    ),
  )(
    "removes only a known new conversation when $operation fails at $stage",
    async ({ operation, stage }) => {
      const input = {
        repoPath: workflow.repoPath,
        runtimeKind: workflow.runtimeKind,
        runtimePolicy: workflow.runtimePolicy,
        sessionScope: workflow.sessionScope,
        workingDirectory: workflow.workingDirectory,
        systemPrompt: workflow.systemPrompt,
      };
      const created =
        operation === "fork"
          ? session({ id: "ses_new", fork: { sessionID: ref.externalSessionId } })
          : session({ id: "ses_new" });
      const received = {
        ...created,
        id: stage === "missing_id" ? undefined : stage === "invalid_id" ? "unsafe-id" : created.id,
        location:
          stage === "directory" || stage === "cleanup"
            ? { ...created.location, directory: "/unexpected" }
            : created.location,
        time: stage === "metadata" ? { ...created.time, created: null } : created.time,
      };
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (
          method === "POST" &&
          (url.pathname === "/api/session" || url.pathname === "/api/session/ses_saved/fork")
        )
          return response(received);
        if (method === "PATCH" || method === "PUT") return noContent();
        if (url.pathname === "/api/session/ses_saved") return response(current);
        if (method === "DELETE")
          return stage === "cleanup"
            ? Response.json({ message: "Cleanup failed" }, { status: 503 })
            : noContent();
        if (method === "GET" && url.pathname.startsWith("/api/session/")) {
          return stage === "confirmation"
            ? Response.json({ message: "Confirmation failed" }, { status: 503 })
            : response(received);
        }
        throw new Error(`Unexpected ${operation} request ${method} ${url.pathname}`);
      });
      const failure = await (
        operation === "start"
          ? controller.startSession(input)
          : controller.forkSession({ ...input, parentExternalSessionId: ref.externalSessionId })
      ).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(OpenCodeOperationError);
      expect(failure).toMatchObject({
        failure: {
          kind: "runtime_operation",
          runtimeOperationFailure: {
            code:
              stage === "confirmation" || stage === "cleanup"
                ? "request_failed"
                : stage === "directory"
                  ? "identity_mismatch"
                  : "invalid_runtime_response",
          },
        },
      });
      if (stage === "confirmation")
        expect(failure).toMatchObject({
          failure: {
            runtimeOperationFailure: {
              externalSessionId: created.id,
              operation:
                operation === "start" ? "confirm the new conversation" : "confirm the fork",
            },
          },
        });
      if (stage === "cleanup") {
        const message = String(failure);
        expect(message).toContain("conversation 'ses_new' failed setup and cleanup");
        expect(message).toContain("in '/unexpected'");
        expect(message).toContain("UnexpectedStatus: 503");
      }
      expect(
        requests.filter(({ method }) => method === "DELETE").map(({ url }) => url.pathname),
      ).toEqual(stage === "invalid_id" || stage === "missing_id" ? [] : ["/api/session/ses_new"]);
      if (stage !== "confirmation")
        expect(requests.filter(({ method }) => method === "PATCH" || method === "PUT")).toEqual([]);
      expect(controller.bindings.has("ses_new")).toBe(false);
    },
  );

  test.each([
    { parent: "missing", id: "ses_new", cleanupFails: false, directory: "/repo" },
    { parent: "wrong", id: "ses_new", cleanupFails: false, directory: "/repo" },
    { parent: "source", id: ref.externalSessionId, cleanupFails: false, directory: "/repo" },
    { parent: "source", id: ref.externalSessionId, cleanupFails: false, directory: "/unexpected" },
    { parent: "wrong", id: "ses_new", cleanupFails: true, directory: "/repo" },
  ])(
    "protects the source and removes invalid forks with $parent parent data in $directory (cleanupFails=$cleanupFails)",
    async ({ parent, id, cleanupFails, directory }) => {
      const created = session({ id, location: { directory } });
      if (parent !== "missing")
        created.fork = { sessionID: parent === "source" ? ref.externalSessionId : "ses_wrong" };
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname.endsWith("/fork") && method === "POST") return response(created);
        if (method === "GET" && url.pathname === "/api/session/ses_saved") return response(current);
        if (method === "DELETE" && url.pathname === "/api/session/ses_new")
          return cleanupFails
            ? Response.json({ message: "Cleanup failed" }, { status: 503 })
            : noContent();
        throw new Error(`Unexpected fork validation request ${method} ${url.pathname}`);
      });
      const failure = await controller
        .forkSession({
          repoPath: repository.repoPath,
          workingDirectory: repository.workingDirectory,
          runtimeKind: repository.runtimeKind,
          runtimePolicy: repository.runtimePolicy,
          sessionScope: repository.sessionScope,
          parentExternalSessionId: ref.externalSessionId,
        })
        .catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(OpenCodeOperationError);
      expect(failure).toMatchObject({
        failure: {
          runtimeOperationFailure: {
            code: cleanupFails ? "request_failed" : "identity_mismatch",
            externalSessionId: ref.externalSessionId,
            operation: "fork the conversation",
          },
        },
      });
      if (cleanupFails)
        expect(failure).toMatchObject({
          message: expect.stringContaining("conversation 'ses_new' failed setup and cleanup"),
        });
      expect(
        requests.filter(({ method }) => method === "DELETE").map(({ url }) => url.pathname),
      ).toEqual(parent === "source" ? [] : ["/api/session/ses_new"]);
      expect(controller.bindings.has("ses_new")).toBe(false);
    },
  );

  test("creates mandatory native controls and the full workflow entry before accepting a turn", async () => {
    let detail = session({ id: "ses_new" });
    const { controller, requests } = createController(
      ({ url, method, body }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname === "/api/session" && method === "POST") return response(detail);
        if (url.pathname.includes("/instructions/entries/")) return noContent();
        if (method === "PATCH") {
          // SAFETY: The real SDK serializes this fixture's SessionInfo metadata and permission rules.
          detail = {
            ...detail,
            metadata: body.metadata as SessionInfo["metadata"],
            permissions: body.permissions as SessionInfo["permissions"],
          };
          return noContent();
        }
        if (url.pathname === "/api/session/ses_new") return response(detail);
        throw new Error(`Unexpected startup ${method} ${url.pathname}`);
      },
      { defaults: [{ permission: "bash", pattern: "bun test*", action: "ask" }], role: [] },
    );
    const started = await controller.startSession({
      repoPath: workflow.repoPath,
      runtimeKind: workflow.runtimeKind,
      runtimePolicy: workflow.runtimePolicy,
      sessionScope: workflow.sessionScope,
      workingDirectory: workflow.workingDirectory,
      systemPrompt: workflow.systemPrompt,
    });
    expect(started.externalSessionId).toBe("ses_new");
    const entry = requests.find((request) => request.method === "PUT");
    expect(entry?.url.pathname).toEndWith("/instructions/entries/openducktor.workflow");
    expect(entry?.body.value).toBe(workflow.systemPrompt);
    expect(detail.permissions).toContainEqual({
      action: "shell",
      resource: "bun test*",
      effect: "ask",
    });
    expect(detail.permissions).toContainEqual({
      action: "subagent",
      resource: "*",
      effect: "deny",
    });
    expect(detail.permissions).toContainEqual({ action: "edit", resource: "*", effect: "deny" });
    expect(detail.metadata?.["openducktor.permissions"]).toMatchObject({
      version: 1,
      legacyAmbiguous: false,
    });
  });
  test("identifies current workflow controls after migration without trusting old fork ownership", async () => {
    const detail = session({
      permissions: [],
      metadata: {
        "openducktor.permissions": {
          version: 1,
          legacyAmbiguous: false,
          spans: [
            {
              layer: "defaults",
              context: "spec",
              start: 0,
              rules: [{ permission: "bash", pattern: "git status*", action: "ask" }],
            },
          ],
        },
      },
    });
    const { controller } = createController(({ url, method, body }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/active") return response({});
      if (method === "PUT") return noContent();
      if (method === "PATCH") {
        Object.assign(detail, body);
        return noContent();
      }
      return response(detail);
    });
    await controller.resumeSession(workflow);
    expect(ownedWorkflowRole(detail)).toBe("spec");
    expect(() => forkNativePermissions(detail, ref)).toThrow("do not match their ownership marker");
    detail.metadata = {
      "openducktor.permissions": { version: 1, legacyAmbiguous: true, spans: [] },
    };
    await controller.resumeSession(workflow);
    expect(ownedWorkflowRole(detail)).toBe("spec");
    expect(() => forkNativePermissions(detail, ref)).toThrow("Cannot prove");
    detail.permissions = [];
    expect(() => ownedWorkflowRole(detail)).toThrow("current mandatory workflow permissions");
  });
  test("rejects saved rules without a safe equivalent before creating a conversation", async () => {
    const { controller, requests } = createController(
      () => Response.json({ status: "completed" }),
      { defaults: [{ permission: "doom_loop", pattern: "*", action: "allow" }], role: [] },
    );
    await expect(controller.startSession(repository)).rejects.toThrow(
      "no safe OpenCode V2 equivalent",
    );
    expect(requests).toHaveLength(1);
  });
  test("reattachment keeps native rules and metadata and ignores new creation defaults", async () => {
    const { controller, requests } = createController(
      ({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname === "/api/session/active") return response({});
        if (method === "PATCH" || method === "PUT") return noContent();
        return response(current);
      },
      { defaults: [{ permission: "shell", pattern: "new default", action: "allow" }], role: [] },
    );
    await controller.resumeSession(repository);
    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.body.metadata).toMatchObject({ native: "retained" });
    expect(patch?.body.permissions).toContainEqual(current.permissions?.[0]);
    expect(patch?.body.permissions).not.toContainEqual({
      action: "shell",
      resource: "new default",
      effect: "allow",
    });
    await expect(controller.resumeSession(workflow)).rejects.toThrow(
      "different OpenDucktor association",
    );
    await expect(
      controller.sendUserMessage({
        ...workflow,
        parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
      }),
    ).rejects.toThrow("different OpenDucktor association");
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });
  test.each([
    {
      label: "server failure",
      code: "request_failed",
      nativeResponse: () => Response.json({ message: "Activity read failed" }, { status: 503 }),
    },
    {
      label: "malformed activity",
      code: "invalid_runtime_response",
      nativeResponse: () => new Response("{", { headers: { "content-type": "application/json" } }),
    },
  ])(
    "reports $label during resume with the exact session and next action",
    async ({ code, nativeResponse }) => {
      const { controller } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname === "/api/session/active") return nativeResponse();
        if (method === "PATCH" || method === "PUT") return noContent();
        return response(session());
      });
      const failure = await controller.resumeSession(repository).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(OpenCodeOperationError);
      if (!(failure instanceof OpenCodeOperationError)) throw new Error("Expected resume failure");
      expect(failure.failure.runtimeOperationFailure).toMatchObject({
        ...ref,
        operation: "read session activity",
        code,
        nativeReason: expect.any(String),
        nextAction: expect.any(String),
      });
    },
  );
  test("returns native inbox IDs for prompts and a separate acknowledgement for compaction", async () => {
    const { controller, requests } = createController(({ url, method, body }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname.endsWith("/prompt"))
        return response({
          id: "inbox_native",
          sessionID: ref.externalSessionId,
          type: "user",
          payload: { text: body.text },
          delivery: "prompt",
          time: { created: 8 },
        });
      if (url.pathname.endsWith("/compact"))
        return response({
          id: "inbox_compaction",
          sessionID: ref.externalSessionId,
          type: "compaction",
          payload: {},
          delivery: "prompt",
          time: { created: 9 },
        });
      if (method === "PATCH") return noContent();
      return response(current);
    });
    expect(
      await controller.sendUserMessage({
        ...repository,
        parts: [{ kind: "text", text: "Keep this" }],
      }),
    ).toMatchObject({ type: "user_message", messageId: "inbox_native", state: "queued" });
    expect(
      await controller.sendUserMessage({
        ...repository,
        parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
      }),
    ).toEqual({ type: "command_accepted", commandName: "compact", inputId: "inbox_compaction" });
    expect(requests.filter((request) => request.url.pathname.endsWith("/prompt"))).toHaveLength(1);
  });
  test("fork removes only proven OpenDucktor spans and preserves native permission order", () => {
    const native = { action: "shell", resource: "git status*", effect: "ask" as const };
    const owned = { permission: "bash", pattern: "bun test*", action: "ask" as const };
    const detail = session({
      permissions: [native, compilePermissionRule(owned)],
      metadata: {
        "openducktor.permissions": {
          version: 1,
          legacyAmbiguous: false,
          spans: [{ layer: "defaults", context: "repository", start: 1, rules: [owned] }],
        },
      },
    });
    expect(forkNativePermissions(detail, ref)).toEqual([native]);
    detail.permissions = [];
    expect(() => forkNativePermissions(detail, ref)).toThrow("do not match their ownership marker");
  });
  test("blocks fork when inherited ownership is unresolved", () => {
    const detail = session({
      permissions: [{ action: "shell", resource: "rm *", effect: "allow" }],
      metadata: {
        "openducktor.permissions": {
          version: 1,
          legacyAmbiguous: false,
          inheritancePending: true,
          spans: [],
        },
      },
    });
    expect(() => forkNativePermissions(detail, ref)).toThrow("Cannot prove");
  });
  test("preserves project and worktree meaning for file rules and edit aliases", async () => {
    const client = nativeClient(() => Response.json({ ...location, directory: "/repo/worktree" }));
    const settings = await compileCreationSettings(
      client,
      { ...ref, workingDirectory: "/repo/worktree" },
      {
        defaults: [
          { permission: "read", pattern: "src/**", action: "ask" },
          { permission: "write", pattern: "/repo/src/**", action: "deny" },
          { permission: "patch", pattern: "/outside/**", action: "ask" },
        ],
        role: [],
      },
    );
    expect(settings.defaults.map(compilePermissionRule)).toEqual([
      { action: "read", resource: "../src/**", effect: "ask" },
      { action: "edit", resource: "../src/**", effect: "deny" },
      { action: "edit", resource: "/outside/**", effect: "ask" },
    ]);
    await expect(
      compileCreationSettings(
        client,
        { ...ref, workingDirectory: "/repo/worktree" },
        { defaults: [{ permission: "edit", pattern: "/repo*/**", action: "deny" }], role: [] },
      ),
    ).rejects.toThrow("across the worktree boundary");
  });
  test.each(
    (["prompt", "compact"] as const).flatMap((submission) =>
      (["stop", "release", "close"] as const).flatMap((action) =>
        (action === "release"
          ? [ref.externalSessionId, "ses_grandchild"]
          : [ref.externalSessionId]
        ).map((externalSessionId) => ({ submission, action, externalSessionId })),
      ),
    ),
  )(
    "does not submit prepared $submission for $externalSessionId after $action during preparation",
    async ({ action, submission, externalSessionId }) => {
      const entered = Promise.withResolvers<void>();
      const allowPolicy = Promise.withResolvers<void>();
      let deferRead = submission === "compact";
      let preparing = false;
      const descendants = [
        session({ ...current, id: "ses_child", parentID: ref.externalSessionId }),
        session({ ...current, id: "ses_grandchild", parentID: "ses_child" }),
      ];
      const target = { ...repository, externalSessionId };
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname.endsWith("/interrupt")) return Response.json({});
        if (url.pathname.endsWith(`/${submission}`))
          return response({
            id: "msg_accepted",
            sessionID: externalSessionId,
            type: submission === "compact" ? "compaction" : "user",
            payload: submission === "compact" ? {} : { text: "Retain draft" },
            delivery: "prompt",
            time: { created: 3 },
          });
        const detail =
          descendants.find((detail) => url.pathname === `/api/session/${detail.id}`) ?? current;
        if (url.pathname === "/api/session/active") return response({});
        if (
          preparing &&
          deferRead &&
          method === "GET" &&
          url.pathname === `/api/session/${externalSessionId}`
        ) {
          deferRead = false;
          entered.resolve();
          return allowPolicy.promise.then(() => response(detail));
        }
        if (method === "PATCH") {
          if (!preparing) return noContent();
          entered.resolve();
          return allowPolicy.promise.then(noContent);
        }
        return response(detail);
      });
      if (externalSessionId !== ref.externalSessionId)
        for (const detail of [current, ...descendants])
          await controller.resumeSession({ ...repository, externalSessionId: detail.id });
      preparing = true;
      const sending = controller.sendUserMessage({
        ...target,
        parts:
          submission === "compact"
            ? [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }]
            : [{ kind: "text", text: "Retain draft" }],
      });
      const failure = sending.catch((cause: unknown) => cause);
      await entered.promise;
      if (action === "stop") await controller.stopSession(ref);
      if (action === "release") await controller.releaseSession(ref);
      if (action === "close") controller.close();
      allowPolicy.resolve();
      const result = await failure;
      expect(requests.some(({ url }) => url.pathname.endsWith(`/${submission}`))).toBe(false);
      expect(result).toMatchObject({
        failure: { runtimeOperationFailure: { code: "runtime_unavailable" } },
      });
    },
  );
});

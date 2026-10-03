import { describe, expect, test } from "bun:test";
import { workflowAgentSessionScope } from "@openducktor/core";
import {
  makeMockClient,
  OpencodeSdkAdapter,
  sessionRuntimeRef,
  defaultRepoRuntimeInput,
} from "./test-support";
import type { OpencodePermissionRule } from "./workflow-tool-permissions";

const nativeRules = (): OpencodePermissionRule[] => [
  { permission: "bash", pattern: "git *", action: "allow" },
  { permission: "bash", pattern: "git push *", action: "ask" },
  { permission: "bash", pattern: "rm *", action: "deny" },
  { permission: "edit", pattern: "secrets/*", action: "deny" },
  { permission: "task", pattern: "explore", action: "allow" },
  { permission: "task", pattern: "build", action: "deny" },
  { permission: "external_directory", pattern: "/tmp/*", action: "ask" },
  { permission: "webfetch", pattern: "*", action: "ask" },
  { permission: "skill", pattern: "private-*", action: "deny" },
  { permission: "doom_loop", pattern: "*", action: "ask" },
  { permission: "other_mcp_*", pattern: "*", action: "deny" },
];

const rulesFor = async (mock: ReturnType<typeof makeMockClient>, id = "session-opencode-1") =>
  (await mock.client.session.get({ sessionID: id, directory: "/repo" })).data!.permission!;

describe("OpenCode session permission continuity", () => {
  test("preserves ordered native rules on workflow resume, later turns, and reattachment", async () => {
    const native = nativeRules();
    const mock = makeMockClient({ sessionPermissions: native });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const ref = sessionRuntimeRef();
    await adapter.resumeSession(ref);
    const installed = await rulesFor(mock);
    expect(installed.slice(0, native.length)).toEqual(native);
    expect(installed.at(-1)?.action).toBe("allow");
    expect(installed.filter((rule) => rule.permission === "task")).toEqual(
      native.filter((rule) => rule.permission === "task"),
    );
    for (const text of ["first", "queued follow-up"]) {
      await adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text }] });
    }
    await adapter.resumeSession(ref);
    expect(await rulesFor(mock)).toEqual(installed);
    expect(mock.session.updateCalls.filter((call) => call.permission)).toHaveLength(1);
    expect(mock.session.promptAsyncCalls).toHaveLength(2);
    for (const call of mock.session.promptAsyncCalls) expect(call).not.toHaveProperty("tools");
    expect(
      mock.session.updateCalls
        .filter((call) => call.title)
        .every((call) => call.permission === undefined),
    ).toBe(true);

    const nativeAfterAttachment: OpencodePermissionRule[] = [
      ...installed,
      { permission: "*", pattern: "*", action: "allow" },
    ];
    await mock.client.session.update({
      sessionID: ref.externalSessionId,
      directory: ref.workingDirectory,
      permission: nativeAfterAttachment,
    });
    await adapter.resumeSession(ref);
    const restored = await rulesFor(mock);
    expect(restored.slice(0, nativeAfterAttachment.length)).toEqual(nativeAfterAttachment);
    expect(restored.slice(nativeAfterAttachment.length)).toEqual(installed.slice(native.length));
  });

  test.each(["", "repository system prompt"])(
    "preserves imported repository permissions with system prompt %j",
    async (systemPrompt) => {
      const native = nativeRules();
      const mock = makeMockClient({ sessionPermissions: native });
      const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
      const ref = sessionRuntimeRef("session-opencode-1", {
        sessionScope: { kind: "repository" },
        systemPrompt,
      });
      await adapter.resumeSession(ref);
      await adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "continue" }] });
      expect(await rulesFor(mock)).toEqual(native);
      expect(mock.session.updateCalls).toEqual([]);
      expect(mock.session.promptAsyncCalls[0]).not.toHaveProperty("tools");
    },
  );

  test("copies source permissions to a fork and leaves its source unchanged", async () => {
    const native = nativeRules();
    const mock = makeMockClient({ sessionPermissions: native });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await adapter.forkSession({
      ...defaultRepoRuntimeInput,
      parentExternalSessionId: "session-opencode-1",
      systemPrompt: "fork",
    });
    expect(await rulesFor(mock)).toEqual(native);
    const fork = await rulesFor(mock, "session-opencode-fork");
    expect(fork.slice(0, native.length)).toEqual(native);
    expect(fork).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(mock.session.getCalls[0]).toEqual({
      sessionID: "session-opencode-1",
      directory: "/repo",
    });
    expect(
      mock.session.updateCalls.every((call) => call.sessionID === "session-opencode-fork"),
    ).toBe(true);
  });

  test("keeps Builder editing and subagent rules native", async () => {
    const native = nativeRules();
    const mock = makeMockClient({ sessionPermissions: native });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await adapter.resumeSession(
      sessionRuntimeRef("session-opencode-1", {
        sessionScope: workflowAgentSessionScope("task-1", "build"),
      }),
    );
    const installed = await rulesFor(mock);
    expect(installed.filter((rule) => ["edit", "bash", "task"].includes(rule.permission))).toEqual(
      native.filter((rule) => ["edit", "bash", "task"].includes(rule.permission)),
    );
  });

  test.each([
    ["pending", "message"],
    ["failed", "message"],
    ["overlapping", "message"],
    ["failed", "continuation"],
  ] as const)(
    "blocks %s permission restoration from admitting a waiting %s and permits recovery",
    async (phase, kind) => {
      const mock = makeMockClient({
        messagesResponse: [
          {
            info: {
              id: "user-1",
              sessionID: "session-opencode-1",
              role: "user",
              time: { created: 1 },
            },
            parts: [
              {
                id: "user-1-part",
                sessionID: "session-opencode-1",
                messageID: "user-1",
                type: "text",
                text: "Interrupted request",
              },
            ],
          },
        ],
      });
      const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
      const ref = sessionRuntimeRef();
      await adapter.resumeSession(ref);
      await mock.client.session.update({
        sessionID: ref.externalSessionId,
        directory: ref.workingDirectory,
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      });
      const mcpStatus = mock.client.mcp.status;
      const statusEntered = Promise.withResolvers<void>();
      const releaseStatus = Promise.withResolvers<void>();
      let statusChecks = 0;
      mock.client.mcp.status = async (...args) => {
        // Continuation restores permissions before its final MCP readiness check.
        if (kind === "continuation" && ++statusChecks === 1) return mcpStatus(...args);
        mock.client.mcp.status = mcpStatus;
        statusEntered.resolve();
        await releaseStatus.promise;
        return mcpStatus(...args);
      };
      const send = (
        kind === "continuation"
          ? adapter.continueInterruptedTurn(ref)
          : adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "blocked" }] })
      ).then(
        () => null,
        (error: Error) => error,
      );
      await statusEntered.promise;
      if (kind === "continuation")
        await mock.client.session.update({
          sessionID: ref.externalSessionId,
          directory: ref.workingDirectory,
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        });
      const update = mock.client.session.update;
      const updateEntered = Promise.withResolvers<void>();
      const releaseUpdate = Promise.withResolvers<void>();
      mock.client.session.update = async () => {
        updateEntered.resolve();
        await releaseUpdate.promise;
        return { data: undefined, error: new Error("permission update rejected") };
      };
      const restore = adapter.resumeSession(ref).then(
        () => null,
        (error: Error) => error,
      );
      await updateEntered.promise;
      if (phase === "overlapping") {
        mock.client.session.update = update;
        await adapter.resumeSession(ref);
      }
      if (phase === "failed") {
        releaseUpdate.resolve();
        expect(await restore).toBeInstanceOf(Error);
      }
      releaseStatus.resolve();
      try {
        const error = await send;
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain("permissions");
        expect(mock.session.promptAsyncCalls).toHaveLength(0);
      } finally {
        releaseUpdate.resolve();
        await restore;
      }
      mock.client.session.update = update;
      await adapter.resumeSession(ref);
      expect(await rulesFor(mock)).toContainEqual({
        permission: "edit",
        pattern: "*",
        action: "deny",
      });
      await adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "recovered" }] });
      expect(mock.session.promptAsyncCalls).toHaveLength(1);
    },
  );

  test.each(["read failure", "update failure", "unconfirmed update"] as const)(
    "blocks an existing binding after %s until validated restoration",
    async (failure) => {
      const mock = makeMockClient();
      const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
      const ref = sessionRuntimeRef();
      await adapter.resumeSession(ref);
      const broadAllow: OpencodePermissionRule[] = [
        { permission: "*", pattern: "*", action: "allow" },
      ];
      await mock.client.session.update({
        sessionID: ref.externalSessionId,
        directory: ref.workingDirectory,
        permission: broadAllow,
      });
      const get = mock.client.session.get;
      if (failure === "read failure")
        mock.client.session.get = async () => ({
          data: undefined,
          error: new Error("permission read rejected"),
        });
      else if (failure === "update failure")
        mock.session.updateResult = { error: new Error("permission update rejected") };
      else
        mock.session.updateResult = {
          data: (await get({ sessionID: ref.externalSessionId, directory: ref.workingDirectory }))
            .data,
        };
      await expect(adapter.resumeSession(ref)).rejects.toThrow("permissions");
      await expect(
        adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "blocked" }] }),
      ).rejects.toThrow("permissions");
      expect(mock.session.promptAsyncCalls).toEqual([]);
      await adapter.replyApproval({ ...ref, requestId: "pending-1", outcome: "reject" });
      expect(mock.permission.replyCalls).toHaveLength(1);
      mock.client.session.get = get;
      mock.session.updateResult = {};
      await adapter.resumeSession(ref);
      const restored = await rulesFor(mock);
      expect(restored.slice(0, broadAllow.length)).toEqual(broadAllow);
      expect(restored).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
      const updates = mock.session.updateCalls.length;
      await adapter.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "recovered" }] });
      expect(mock.session.promptAsyncCalls).toHaveLength(1);
      expect(mock.session.promptAsyncCalls[0]).not.toHaveProperty("tools");
      expect(mock.session.updateCalls).toHaveLength(updates);
    },
  );

  test.each([
    "wrong identity",
    "omitted permission",
    "malformed permission",
    "unconfirmed permission",
  ])("blocks the next turn when permission setup returns %s", async (kind) => {
    const mock = makeMockClient({ sessionPermissions: nativeRules() });
    const update = mock.client.session.update;
    mock.client.session.update = async (...args) => {
      const result = await update(...args);
      // SAFETY: The fixture deliberately returns corrupt SDK data to test ingress rejection.
      return {
        ...result,
        data: {
          ...result.data!,
          id: kind === "wrong identity" ? "another-session" : result.data!.id,
          permission:
            kind === "omitted permission"
              ? undefined
              : kind === "malformed permission"
                ? [{ permission: "bash", pattern: "*", action: "invalid" }]
                : [],
        },
      } as typeof result;
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef(),
        parts: [{ kind: "text", text: "continue" }],
      }),
    ).rejects.toThrow("Reconnect the selected OpenCode runtime");
    expect(mock.session.promptAsyncCalls).toEqual([]);
    // The malformed primary response cannot be replaced by a second read.
    expect(mock.session.getCalls).toHaveLength(1);
  });

  test("fails a fork before creation when its source permissions are malformed", async () => {
    const mock = makeMockClient();
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => {
      const response = await get(...args);
      // SAFETY: A null permission array simulates malformed native data at the SDK boundary.
      return { ...response, data: { ...response.data!, permission: null } } as typeof response;
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await expect(
      adapter.forkSession({
        ...defaultRepoRuntimeInput,
        parentExternalSessionId: "session-opencode-1",
        systemPrompt: "fork",
      }),
    ).rejects.toThrow("read permissions");
    expect(mock.session.forkCalls).toEqual([]);
  });

  test("fails fresh creation when OpenCode does not confirm installed permissions", async () => {
    const mock = makeMockClient();
    const create = mock.client.session.create;
    mock.client.session.create = async (...args) => {
      const response = await create(...args);
      return { ...response, data: { ...response.data!, permission: undefined } };
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await expect(
      adapter.startSession({ ...defaultRepoRuntimeInput, systemPrompt: "start" }),
    ).rejects.toThrow("did not confirm");
    expect(mock.session.promptAsyncCalls).toEqual([]);
  });

  test("reports the policy and cleanup errors for an unusable fork", async () => {
    const mock = makeMockClient({ sessionUpdateResult: { error: new Error("policy rejected") } });
    mock.client.session.delete = async () => {
      throw new Error("cleanup rejected");
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const failure = await adapter
      .forkSession({
        ...defaultRepoRuntimeInput,
        parentExternalSessionId: "session-opencode-1",
        systemPrompt: "fork",
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toContain("session-opencode-fork");
    expect(failure.message).toContain("policy rejected");
    expect(failure.message).toContain("cleanup rejected");
    expect(mock.session.promptAsyncCalls).toEqual([]);
  });
});

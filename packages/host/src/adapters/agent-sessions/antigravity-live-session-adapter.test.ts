import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk/unstable";
import {
  type AntigravityMode,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  type AgentSessionLiveAdapterChange,
  AgentSessionLiveRegistration,
} from "../../ports/agent-session-live-adapter-port";
import { createAntigravityClientApp } from "../antigravity/antigravity-acp-process";
import { AntigravityRuntimeSessions } from "../antigravity/antigravity-runtime-sessions";
import { ANTIGRAVITY_CLIENT_CAPABILITIES } from "../antigravity/antigravity-native-contract";
import { createFakeAntigravityAgent } from "../antigravity/antigravity-test-agent.test-support";
import { createAntigravityLiveSessionAdapterPreparer } from "./antigravity-live-session-adapter";

const runtime: RuntimeInstanceSummary = {
  kind: "antigravity",
  runtimeId: "runtime-1",
  runtimeRoute: { type: "stdio", identity: "runtime-1" },
  startedAt: "2026-11-21T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.antigravity,
};

const sessionScope = { kind: "repository" as const, workspaceId: "workspace-1" };

const prepareAdapter = async ({
  failPublication = false,
  sessionMode = "auto",
}: { failPublication?: boolean; sessionMode?: AntigravityMode } = {}) => {
  // The runtime setting can change between sessions, so a test can change this mode.
  const setting = { mode: sessionMode };
  const changes: AgentSessionLiveAdapterChange[] = [];
  const prewarmed: string[] = [];
  const released: string[] = [];
  let failNext = failPublication;
  const runtimeSessions = new AntigravityRuntimeSessions();
  const prepared = await Effect.runPromise(
    createAntigravityLiveSessionAdapterPreparer({
      liveSessionLifecycle: {
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            Effect.flatMap(mutation, ({ value, changes: mutationChanges }) => {
              const isFault = mutationChanges.every((change) => change.type === "fault");
              if (failNext && !isFault) {
                failNext = false;
                return Effect.fail(
                  new HostOperationError({ operation: "test.publish", message: "Publish failed." }),
                );
              }
              changes.push(...mutationChanges);
              return Effect.succeed(value);
            }),
          ),
      },
      resolveMcpServerConfig: (_repoPath, workspaceId) =>
        Effect.succeed({
          command: ["/bin/odt-mcp"],
          environment: {
            ODT_WORKSPACE_ID: workspaceId ?? "",
            ODT_HOST_URL: "http://127.0.0.1:1",
            ODT_HOST_TOKEN: "token",
            ODT_FORBID_WORKSPACE_ID_INPUT: "true",
            ODT_ALLOWED_TOOLS: "",
            ODT_RUNTIME_KIND: "antigravity",
          },
        }),
      resolveSessionMode: () => Effect.sync(() => setting.mode),
      resolveWorkflowRolePolicy: () => ({ tools: [], readOnly: false }),
      directoriesMatch: (left, right) => Effect.succeed(left === right),
      attachmentStageDirectory: "/tmp/openducktor-local-attachments",
      createFileSearch: () => ({
        prewarm: (directory) => void prewarmed.push(directory),
        release: (directory) => void released.push(directory),
        search: async () => [],
        dispose: () => undefined,
      }),
      readEnv: () => ({}),
      runtimeSessions,
    })(runtime, "/bin/agy"),
  );
  const fake = createFakeAntigravityAgent();
  const connection = createAntigravityClientApp(prepared.acp.handlers).connect(fake.app);
  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: ANTIGRAVITY_CLIENT_CAPABILITIES,
  });
  prepared.acp.attachConnection(connection);
  await Effect.runPromise(prepared.startForwarding());
  return {
    prepared,
    adapter: prepared.adapter,
    changes,
    fake,
    prewarmed,
    released,
    runtimeSessions,
    setting,
  };
};

const startEffect = (adapter: Awaited<ReturnType<typeof prepareAdapter>>["adapter"]) =>
  adapter.startSession({
    repoPath: "/repo",
    runtimeKind: "antigravity",
    workingDirectory: "/repo/worktree",
    sessionScope,
    systemPrompt: "Help with the repository.",
  });

const startSession = (adapter: Awaited<ReturnType<typeof prepareAdapter>>["adapter"]) =>
  Effect.runPromise(startEffect(adapter));

const resume = (
  adapter: Awaited<ReturnType<typeof prepareAdapter>>["adapter"],
  externalSessionId: string,
) =>
  adapter.resumeSession({
    repoPath: "/repo",
    runtimeKind: "antigravity",
    workingDirectory: "/repo/worktree",
    externalSessionId,
    sessionScope,
    systemPrompt: "Help.",
    resumeMode: "reattach",
  });

describe("Antigravity live session adapter", () => {
  test("publishes a started session and prepares its file search", async () => {
    const { adapter, changes, prewarmed } = await prepareAdapter();

    const summary = await startSession(adapter);

    expect(summary).toMatchObject({ runtimeKind: "antigravity", status: "idle" });
    expect(changes.map((change) => change.type)).toEqual(["session_upsert"]);
    expect(prewarmed).toEqual(["/repo/worktree"]);
    const snapshots = await Effect.runPromise(adapter.listSnapshots());
    expect(snapshots.map((snapshot) => snapshot.ref.externalSessionId)).toEqual([
      summary.externalSessionId,
    ]);
  });

  test("lists the command list and the skills of a session directory in the runtime catalog", async () => {
    const { adapter, fake } = await prepareAdapter();
    const summary = await startSession(adapter);
    const sent = Effect.runPromise(
      adapter.sendUserMessage({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId: summary.externalSessionId,
        sessionScope,
        parts: [{ kind: "text", text: "Hello" }],
        delivery: "new_turn",
      }),
    );
    const prompt = await fake.waitForPrompts(1);
    await prompt.client.notify(methods.client.session.update, {
      sessionId: summary.externalSessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "plan", description: "Plan the work." },
          { name: "clean-code", description: "Coding standards." },
        ],
      },
    });
    prompt.respond({ stopReason: "end_turn" });
    await sent;

    const commands = await Effect.runPromise(
      adapter.queries.loadRuntimeCatalog({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
      }),
    );
    expect(commands.slashCommands).toEqual({
      status: "available",
      catalog: {
        commands: [
          {
            id: "antigravity:plan",
            trigger: "plan",
            title: "/plan",
            description: "Plan the work.",
            source: "command",
            hints: [],
          },
          {
            id: "antigravity:clean-code",
            trigger: "clean-code",
            title: "/clean-code",
            description: "Coding standards.",
            source: "skill",
            hints: [],
          },
        ],
      },
    });
    // Antigravity lists its skills as commands, so `$` offers the same skills.
    expect(commands.skills).toEqual({
      status: "available",
      catalog: {
        skills: [
          {
            id: "clean-code",
            name: "clean-code",
            path: "clean-code",
            title: "clean-code",
            description: "Coding standards.",
          },
        ],
      },
    });
  });

  test("lists the newest command list of a live session in the directory, and drops a released one", async () => {
    const { adapter, fake } = await prepareAdapter();
    const startWithCommands = async (name: string) => {
      fake.updatesOnConfig.splice(0, fake.updatesOnConfig.length, {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name, description: `${name} command.` }],
      });
      return Effect.runPromise(
        adapter.startSession({
          repoPath: "/repo",
          runtimeKind: "antigravity",
          workingDirectory: "/repo/worktree",
          sessionScope,
          systemPrompt: "Help.",
          model: { runtimeKind: "antigravity", providerId: "antigravity", modelId: "gemini-pro" },
        }),
      );
    };
    const catalogIds = async () => {
      const catalog = await Effect.runPromise(
        adapter.queries.loadRuntimeCatalog({
          repoPath: "/repo",
          runtimeKind: "antigravity",
          workingDirectory: "/repo/worktree",
        }),
      );
      const slashCommands = catalog.slashCommands;
      return slashCommands?.status === "available"
        ? slashCommands.catalog.commands.map((command) => command.id)
        : null;
    };
    await startWithCommands("first");
    const second = await startWithCommands("second");
    expect(await catalogIds()).toEqual(["antigravity:second"]);

    await Effect.runPromise(
      adapter.releaseSession({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId: second.externalSessionId,
      }),
    );

    expect(await catalogIds()).toEqual(["antigravity:first"]);
  });

  test("lists the command list that Antigravity sends just after it reopens a session", async () => {
    const { adapter, fake } = await prepareAdapter();
    fake.sessions.push({ sessionId: "saved-1", cwd: "/repo/worktree" });
    fake.updatesAfterLoad.push({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "goal", description: "Work toward a goal." }],
    });

    await Effect.runPromise(
      adapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId: "saved-1",
        sessionScope,
        systemPrompt: "Help.",
        resumeMode: "reattach",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const catalog = await Effect.runPromise(
      adapter.queries.loadRuntimeCatalog({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
      }),
    );
    const slashCommands = catalog.slashCommands;
    expect(
      slashCommands?.status === "available"
        ? slashCommands.catalog.commands.map((command) => command.id)
        : null,
    ).toEqual(["antigravity:goal"]);
  });

  test("reports a failed publication as a fault of the session", async () => {
    const { adapter, changes } = await prepareAdapter({ failPublication: true });

    const failure = await Effect.runPromise(Effect.flip(startEffect(adapter)));

    expect(failure.message).toContain("Publish failed.");
    // The failed start then removes the session that it could not publish.
    expect(changes.map((change) => change.type)).toEqual(["fault", "session_removed"]);
    expect(changes[0]).toMatchObject({ type: "fault", message: "Publish failed." });
  });

  test("generates a JSON answer with the JSON Schema in the instructions", async () => {
    const { adapter, fake } = await prepareAdapter();

    const generation = Effect.runPromise(
      adapter.textGeneration.generateJson({
        repoPath: "/repo",
        model: { runtimeKind: "antigravity", providerId: "antigravity", modelId: "gemini" },
        instructions: "Name it.",
        prompt: "A task",
        answerSchema: z.strictObject({ title: z.string() }),
      }),
    );
    const prompt = await fake.waitForPrompts(1);
    expect(fake.created[0]?._meta).toEqual({
      antigravity: { systemPrompt: { append: expect.stringContaining('"title"') } },
    });
    await prompt.client.notify(methods.client.session.update, {
      sessionId: prompt.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: '```json\n{"title":"Fix login"}\n```' },
      },
    });
    prompt.respond({ stopReason: "end_turn" });

    expect(await generation).toEqual({ title: "Fix login" });
  });

  test("closes a released session and releases the file search of its directory", async () => {
    const { adapter, fake, released } = await prepareAdapter();
    const summary = await startSession(adapter);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "antigravity" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: summary.externalSessionId,
    };

    await Effect.runPromise(adapter.releaseSession(ref));

    expect(fake.closed).toEqual([summary.externalSessionId]);
    expect(released).toEqual(["/repo/worktree"]);
    expect(await Effect.runPromise(adapter.listSnapshots())).toEqual([]);
  });

  test("reopens a saved session only in its saved directory, and releases the file search of a failed open", async () => {
    const { adapter, fake, released } = await prepareAdapter();
    fake.sessions.push({ sessionId: "saved-1", cwd: "/other" });

    const wrongDirectory = await Effect.runPromise(Effect.flip(resume(adapter, "saved-1")));

    expect(wrongDirectory.message).toContain("belongs to '/other'");
    expect(fake.loaded).toEqual([]);
    expect(released).toEqual(["/repo/worktree"]);
  });

  test("reopens a session that got no message, which Antigravity does not list", async () => {
    const { adapter, fake } = await prepareAdapter();
    const { externalSessionId } = await startSession(adapter);
    await Effect.runPromise(
      adapter.releaseSession({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId,
      }),
    );

    const reopened = await Effect.runPromise(resume(adapter, externalSessionId));

    expect(fake.sessions).toEqual([]);
    expect(fake.loaded.map((load) => load.sessionId)).toEqual([externalSessionId]);
    expect(reopened.externalSessionId).toBe(externalSessionId);
  });

  test("sets the session mode of the runtime setting when a session starts and reopens", async () => {
    const { adapter, fake, setting } = await prepareAdapter({ sessionMode: "accept-edits" });
    const { externalSessionId } = await startSession(adapter);
    setting.mode = "auto";
    await Effect.runPromise(
      adapter.releaseSession({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId,
      }),
    );
    await Effect.runPromise(resume(adapter, externalSessionId));

    expect(fake.modes.map(({ sessionId, value }) => [sessionId, value])).toEqual([
      [externalSessionId, "accept-edits"],
      [externalSessionId, "auto"],
    ]);
  });

  test("runs a bypass session in auto and approves each request without asking", async () => {
    const { adapter, fake } = await prepareAdapter({ sessionMode: "bypass-permissions" });
    const { externalSessionId } = await startSession(adapter);
    const sent = Effect.runPromise(
      adapter.sendUserMessage({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId,
        sessionScope,
        parts: [{ kind: "text", text: "Delete the build folder" }],
        delivery: "new_turn",
      }),
    );
    const prompt = await fake.waitForPrompts(1);

    const reply = await prompt.client.request(methods.client.session.requestPermission, {
      sessionId: externalSessionId,
      toolCall: { toolCallId: "rm-1", kind: "execute", title: "rm -rf build" },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    });
    prompt.respond({ stopReason: "end_turn" });
    await sent;

    expect(fake.modes.map(({ value }) => value)).toEqual(["auto"]);
    expect(reply.outcome).toEqual({ outcome: "selected", optionId: "allow" });
    const snapshot = await Effect.runPromise(adapter.listSnapshots());
    expect(snapshot.flatMap((entry) => entry.pendingApprovals ?? [])).toEqual([]);
  });

  test("runs a goal as /goal, shows its state, and clears it with the stop message", async () => {
    const { adapter, fake } = await prepareAdapter();
    const { externalSessionId } = await startSession(adapter);
    const target = {
      repoPath: "/repo",
      runtimeKind: "antigravity" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId,
    };
    const goal = (command: Parameters<typeof adapter.controlGoal>[0]["command"]) =>
      Effect.runPromise(adapter.controlGoal({ ...target, sessionScope, command }));
    const snapshotGoal = async () =>
      (await Effect.runPromise(adapter.listSnapshots())).find(
        (snapshot) => snapshot.ref.externalSessionId === externalSessionId,
      )?.goal;
    const reply = async (
      prompt: Awaited<ReturnType<typeof fake.waitForPrompts>>,
      textReply: string,
    ) => {
      await prompt.client.notify(methods.client.session.update, {
        sessionId: externalSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: textReply },
        },
      });
      prompt.respond({ stopReason: "end_turn" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    expect(await goal({ kind: "set", objective: "Ship it" })).toEqual({
      type: "command_accepted",
      commandName: "goal",
    });
    const setPrompt = await fake.waitForPrompts(1);
    expect(setPrompt.params.prompt).toEqual([{ type: "text", text: "/goal Ship it" }]);
    expect(await snapshotGoal()).toEqual({ objective: "Ship it", status: "active" });
    await reply(setPrompt, "Shipped. <!-- GOAL_COMPLETE -->");
    expect(await snapshotGoal()).toEqual({ objective: "Ship it", status: "complete" });

    // A clear of an ended goal needs no message.
    await goal({ kind: "clear" });
    expect(await snapshotGoal()).toBeUndefined();
    expect(fake.prompts).toHaveLength(1);

    await goal({ kind: "set", objective: "Ship again" });
    await reply(await fake.waitForPrompts(2), "Working.");
    expect(await snapshotGoal()).toEqual({
      objective: "Ship again",
      status: "waiting_for_message",
    });
    await goal({ kind: "clear" });
    const stopPrompt = await fake.waitForPrompts(3);
    expect(stopPrompt.params.prompt).toEqual([
      { type: "text", text: "Stop the current goal. I'll take it from here." },
    ]);
    expect(await snapshotGoal()).toEqual({
      objective: "Ship again",
      status: "waiting_for_message",
    });
    await reply(stopPrompt, "Stopped. <!-- GOAL_CANCELLED -->");
    expect(await snapshotGoal()).toBeUndefined();

    const refused = await Effect.runPromise(
      Effect.flip(adapter.controlGoal({ ...target, sessionScope, command: { kind: "pause" } })),
    );
    expect(refused.message).toBe("Antigravity cannot pause a goal.");
  });

  test("refuses to open a session in a mode that Antigravity does not offer", async () => {
    const { adapter, fake } = await prepareAdapter({ sessionMode: "auto" });
    fake.offeredModes.splice(fake.offeredModes.indexOf("auto"), 1);

    const failure = await Effect.runPromise(Effect.flip(startEffect(adapter)));

    expect(failure.message).toContain("Antigravity does not offer the session mode 'auto'.");
    expect(fake.closed).toHaveLength(1);
    expect(await Effect.runPromise(adapter.listSnapshots())).toEqual([]);
  });

  test("stops and probes the sessions of the runtime by its runtime ID until it is released", async () => {
    const { adapter, fake, runtimeSessions } = await prepareAdapter();
    const summary = await startSession(adapter);
    const target = {
      repoPath: "/repo",
      runtimeKind: "antigravity" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: summary.externalSessionId,
    };
    const sent = Effect.runPromise(
      adapter.sendUserMessage({
        ...target,
        sessionScope,
        parts: [{ kind: "text", text: "Work" }],
        delivery: "new_turn",
      }),
    );
    const prompt = await fake.waitForPrompts(1);
    prompt.respond({ stopReason: "end_turn" });
    await sent;
    // The send resolves when the prompt goes out, so the turn ends with the next answer.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const probe = () =>
      Effect.runPromise(runtimeSessions.operations.probeSessionStatus(target, runtime));
    expect(await probe()).toEqual({ supported: true, hasLiveSession: false });
    await Effect.runPromise(runtimeSessions.operations.stopSession(target, runtime));
    await Effect.runPromise(adapter.releaseRuntime());

    const failure = await Effect.runPromise(
      Effect.flip(runtimeSessions.operations.probeSessionStatus(target, runtime)),
    );
    expect(failure.message).toContain("Antigravity runtime 'runtime-1' is not running.");
  });
});

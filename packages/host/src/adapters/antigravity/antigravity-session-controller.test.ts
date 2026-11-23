import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  methods,
  type PermissionOption,
  RequestError,
  type SessionUpdate,
} from "@agentclientprotocol/sdk/unstable";
import { type AgentSessionScope, slashCommandCatalogSchema } from "@openducktor/contracts";
import { AgentSessionMessageRefusedError, AgentSessionTurnActiveError } from "@openducktor/core";
import { createConnectedController } from "./antigravity-test-agent.test-support";

type Harness = Awaited<ReturnType<typeof createConnectedController>>;

const workflowScope = (role: "build" | "qa"): AgentSessionScope => ({
  kind: "workflow",
  workspaceId: "workspace-1",
  taskId: "task-1",
  role,
});

const startBuildSession = async (harness: Harness, role: "build" | "qa" = "build") => {
  const summary = await harness.controller.startSession({
    repoPath: "/repo",
    workingDirectory: "/repo/worktree",
    sessionScope: workflowScope(role),
    systemPrompt: "Build the task.",
    model: {
      runtimeKind: "antigravity",
      providerId: "antigravity",
      modelId: "gemini-3.8-flash",
      variant: "low",
    },
  });
  return {
    summary,
    ref: {
      repoPath: "/repo",
      runtimeKind: "antigravity" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: summary.externalSessionId,
    },
  };
};

const sendText = (
  harness: Harness,
  ref: Awaited<ReturnType<typeof startBuildSession>>["ref"],
  text: string,
  delivery: "new_turn" | "steer" = "new_turn",
) => harness.controller.sendUserMessage({ ...ref, parts: [{ kind: "text", text }], delivery });

const eventTypes = (harness: Harness) =>
  harness.changes.flatMap((change) => change.events.map((event) => event.type));

const userMessages = (harness: Harness) =>
  harness.changes.flatMap((change) =>
    change.events.flatMap((event) =>
      event.type === "user_message"
        ? [{ state: event.state, submissionId: event.submissionId }]
        : [],
    ),
  );

const lastSnapshot = (harness: Harness) =>
  harness.changes.flatMap((change) => change.snapshots).at(-1);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AntigravitySessionController", () => {
  test("starts a session in its directory with the role tools, caller binding, and instructions", async () => {
    const harness = await createConnectedController();
    const { summary, ref } = await startBuildSession(harness);

    const request = harness.fake.created[0];
    expect(request?.cwd).toBe("/repo/worktree");
    expect(request?._meta).toEqual({
      antigravity: { systemPrompt: { append: "Build the task." } },
    });
    const server = request?.mcpServers[0];
    expect(server && "command" in server ? server.command : null).toBe("/bin/odt-mcp");
    const env = Object.fromEntries(
      (server && "env" in server ? server.env : []).map((entry) => [entry.name, entry.value]),
    );
    expect(env.ODT_ALLOWED_TOOLS).toBe("odt_read_task,odt_set_task_artifact");
    expect(env.ODT_WORKSPACE_ID).toBe("workspace-1");
    expect(
      harness.controller.resolveCallerBinding(env.ODT_RUNTIME_CALLER_BINDING_ID ?? ""),
    ).toEqual(ref);
    expect(harness.fake.configOptions.map(({ configId, value }) => [configId, value])).toEqual([
      ["model", "gemini-3.8-flash"],
      ["thought_level", "low"],
    ]);
    expect(summary.model).toEqual({
      runtimeKind: "antigravity",
      providerId: "antigravity",
      modelId: "gemini-3.8-flash",
      variant: "low",
    });
    expect(harness.changes[0]?.admittedRoot).toEqual({
      ...ref,
      sessionScope: workflowScope("build"),
    });
  });

  test("accepts a message that starts a turn at once and settles the completed turn", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);

    const sent = sendText(harness, ref, "Hello");
    const prompt = await harness.fake.waitForPrompts(1);
    // Nothing runs ahead of the message, so it counts as read before any turn content.
    const accepted = await sent;
    expect(accepted.messageId).toBe(`${ref.externalSessionId}:t1:user`);
    expect(accepted.message).toBe("Hello");
    expect(userMessages(harness)).toEqual([{ state: "read", submissionId: undefined }]);
    expect(lastSnapshot(harness)?.activity).toBe("running");
    await prompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi there" } },
    });

    prompt.respond({ stopReason: "end_turn" });
    await settle();

    expect(eventTypes(harness)).toEqual([
      "session_status",
      "user_message",
      "assistant_delta",
      "assistant_part",
      "assistant_message",
      "session_idle",
    ]);
    const idle = harness.changes.flatMap((change) => change.events).at(-1);
    expect(idle?.type === "session_idle" ? idle.turnOutcome : null).toBe("completed");
    expect(lastSnapshot(harness)?.activity).toBe("idle");
    // History gives the final reply its model and the work time since the user sent the message.
    const reply = (await harness.controller.loadHistory(ref)).at(-1);
    expect(reply).toMatchObject({ role: "assistant", model: { modelId: "gemini-3.8-flash" } });
    expect(reply?.role === "assistant" ? reply.durationMs : null).toBeGreaterThanOrEqual(0);
  });

  test("refuses a new turn while a turn runs, and joins a steer to it", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    const first = sendText(harness, ref, "First");
    const firstPrompt = await harness.fake.waitForPrompts(1);
    firstPrompt.respond({ stopReason: "end_turn" });
    // The answer of a prompt admits it, and the turn ends with the last open prompt.
    await first;
    await settle();

    const second = sendText(harness, ref, "Second");
    const secondPrompt = await harness.fake.waitForPrompts(2);
    await secondPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking" } },
    });
    await second;

    const busy = await sendText(harness, ref, "Third").catch((cause: unknown) => cause);
    expect(busy).toBeInstanceOf(AgentSessionTurnActiveError);

    const steer = sendText(harness, ref, "Also this", "steer");
    const steerPrompt = await harness.fake.waitForPrompts(3);
    secondPrompt.respond({ stopReason: "end_turn" });
    await settle();
    // The earlier answer does not admit the steer. Turn content after it does.
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(true);
    await steerPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Both" } },
    });
    const steered = await steer;
    expect(steered.messageId).toBe(`${ref.externalSessionId}:t3:user`);
    await settle();
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(true);

    steerPrompt.respond({ stopReason: "end_turn" });
    await settle();
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(false);
  });

  test("keeps the context use that Antigravity reports before session/new answers", async () => {
    const harness = await createConnectedController();
    await startBuildSession(harness);

    expect(lastSnapshot(harness)?.contextUsage).toMatchObject({
      totalTokens: 0,
      contextWindow: 1000,
    });
  });

  test("removes a session whose model choice fails and closes it", async () => {
    const harness = await createConnectedController();

    const failure = await harness.controller
      .startSession({
        repoPath: "/repo",
        workingDirectory: "/repo/worktree",
        sessionScope: workflowScope("build"),
        systemPrompt: "Build the task.",
        model: { runtimeKind: "antigravity", providerId: "antigravity", modelId: "unknown-model" },
      })
      .catch((cause: unknown) => cause);

    expect(String(failure)).toContain("Unknown model 'unknown-model'.");
    expect(harness.changes.at(-1)?.removedRefs.map((ref) => ref.externalSessionId)).toEqual([
      "session-1",
    ]);
    expect(harness.fake.closed).toEqual(["session-1"]);
    expect(harness.controller.listSnapshots()).toEqual([]);
  });

  test("restores the previous native model when Antigravity refuses the thinking level", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);

    const failure = await harness.controller
      .updateModel(ref, {
        runtimeKind: "antigravity",
        providerId: "antigravity",
        modelId: "gemini-pro",
        variant: "unknown-model",
      })
      .catch((cause: unknown) => cause);

    expect(String(failure)).toContain("Unknown model 'unknown-model'.");
    expect(
      harness.fake.configOptions.slice(2).map(({ configId, value }) => [configId, value]),
    ).toEqual([
      ["model", "gemini-pro"],
      ["thought_level", "unknown-model"],
      ["model", "gemini-3.8-flash"],
      ["thought_level", "low"],
    ]);
    expect(lastSnapshot(harness)?.model?.modelId).toBe("gemini-3.8-flash");
  });

  test("restores the native model of an opened session when the selection rolls back to none", async () => {
    const harness = await createConnectedController();
    const summary = await harness.controller.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo/worktree",
      sessionScope: workflowScope("build"),
      systemPrompt: "Build the task.",
    });
    const ref = { ...summary, repoPath: "/repo", runtimeKind: "antigravity" as const };
    const selection = {
      runtimeKind: "antigravity" as const,
      providerId: "antigravity",
      modelId: "gemini-next",
      variant: "high",
    };

    await harness.controller.updateModel(ref, selection);
    await harness.controller.updateModel(ref, null);

    expect(harness.fake.configOptions.map(({ configId, value }) => [configId, value])).toEqual([
      ["model", "gemini-next"],
      ["thought_level", "high"],
      ["model", "gemini-flash"],
      ["thought_level", "medium"],
    ]);
    expect(lastSnapshot(harness)?.model).toBeUndefined();
  });

  test("refuses messages while the native model differs from the selected model", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    harness.fake.refusedConfigValues.add("bad-level");
    harness.fake.refusedConfigValues.add("gemini-3.8-flash");
    const selection = {
      runtimeKind: "antigravity" as const,
      providerId: "antigravity",
      modelId: "gemini-next",
      variant: "bad-level",
    };

    const failure = await harness.controller
      .updateModel(ref, selection)
      .catch((cause: unknown) => cause);
    expect(String(failure)).toContain("did not restore the earlier model");
    const refused = await sendText(harness, ref, "Hello").catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(AgentSessionMessageRefusedError);
    expect(String(refused)).toContain("Antigravity runs model 'gemini-next'");

    harness.fake.refusedConfigValues.delete("gemini-3.8-flash");
    await harness.controller.updateModel(ref, {
      ...selection,
      modelId: "gemini-3.8-flash",
      variant: "low",
    });
    const sent = sendText(harness, ref, "Hello");
    (await harness.fake.waitForPrompts(1)).respond({ stopReason: "end_turn" });
    await sent;
  });

  test("refuses messages after a failed change when Antigravity reported no earlier model", async () => {
    const harness = await createConnectedController();
    harness.fake.settings.omitOpenConfigOptions = true;
    const summary = await harness.controller.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo/worktree",
      sessionScope: workflowScope("build"),
      systemPrompt: "Build the task.",
    });
    const ref = { ...summary, repoPath: "/repo", runtimeKind: "antigravity" as const };

    const failure = await harness.controller
      .updateModel(ref, {
        runtimeKind: "antigravity",
        providerId: "antigravity",
        modelId: "gemini-next",
        variant: "unknown-model",
      })
      .catch((cause: unknown) => cause);

    expect(String(failure)).toContain("did not restore the earlier model");
    const refused = await sendText(harness, ref, "Hello").catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(AgentSessionMessageRefusedError);
    expect(harness.fake.prompts).toHaveLength(0);
  });

  test("keeps the IDs of the running turn when the runtime refuses a steer", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    const first = sendText(harness, ref, "First");
    const firstPrompt = await harness.fake.waitForPrompts(1);
    await firstPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
    });
    await first;

    const steer = sendText(harness, ref, "Also this", "steer");
    const steerPrompt = await harness.fake.waitForPrompts(2);
    // Content of the running turn does not admit the steer.
    await firstPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "More" } },
    });
    steerPrompt.respond(RequestError.invalidParams(undefined, "Steer refused"));

    const refused = await steer.catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(AgentSessionMessageRefusedError);
    await settle();
    // The pending row of the steer leaves again, and no read message names its submission.
    expect(userMessages(harness).map(({ state }) => state)).toEqual(["read", "pending"]);
    expect(eventTypes(harness)).toContain("transcript_retracted");
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(true);

    firstPrompt.respond({ stopReason: "end_turn" });
    await settle();
    const next = sendText(harness, ref, "Next");
    (await harness.fake.waitForPrompts(3)).respond({ stopReason: "end_turn" });
    // Replay counts only admitted messages, so the next message is turn 2 in both views.
    expect((await next).messageId).toBe(`${ref.externalSessionId}:t2:user`);
    const history = await harness.controller.loadHistory(ref);
    expect(history.filter(({ role }) => role === "user").map(({ messageId }) => messageId)).toEqual(
      [`${ref.externalSessionId}:t1:user`, `${ref.externalSessionId}:t2:user`],
    );
    expect(history.find(({ role }) => role === "assistant")?.messageId).toBe(
      `${ref.externalSessionId}:t1:i1`,
    );
  });

  test("keeps a steer unadmitted and the turn completed when the earlier turn ends on its own", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    const first = sendText(harness, ref, "First");
    const firstPrompt = await harness.fake.waitForPrompts(1);
    await firstPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } },
    });
    await first;

    const steer = sendText(harness, ref, "Also this", "steer");
    const steerPrompt = await harness.fake.waitForPrompts(2);
    firstPrompt.respond({ stopReason: "end_turn" });
    await settle();
    steerPrompt.respond(RequestError.invalidParams(undefined, "Invalid params"));

    expect(await steer.catch((cause: unknown) => cause)).toBeInstanceOf(
      AgentSessionMessageRefusedError,
    );
    expect(userMessages(harness).filter(({ state }) => state === "read")).toHaveLength(1);
    await settle();
    const events = harness.changes.flatMap((change) => change.events);
    expect(events.some((event) => event.type === "assistant_message")).toBe(true);
    const idle = events.at(-1);
    expect(idle?.type === "session_idle" ? idle.turnOutcome : null).toBe("completed");
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(false);
  });

  test("ends the turn as failed when an admitted prompt fails and the next steer is refused", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    const first = sendText(harness, ref, "First");
    const firstPrompt = await harness.fake.waitForPrompts(1);
    await firstPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Partial" } },
    });
    await first;
    const steer = sendText(harness, ref, "Also this", "steer");
    const steerPrompt = await harness.fake.waitForPrompts(2);

    firstPrompt.respond(RequestError.internalError(undefined, "Model failed"));
    await settle();
    steerPrompt.respond(RequestError.invalidParams(undefined, "Steer refused"));

    expect(await steer.catch((cause: unknown) => cause)).toBeInstanceOf(
      AgentSessionMessageRefusedError,
    );
    await settle();
    const events = harness.changes.flatMap((change) => change.events);
    expect(events.find((event) => event.type === "turn_error")).toMatchObject({
      message: expect.stringContaining("Model failed"),
    });
    const idle = events.at(-1);
    expect(idle?.type === "session_idle" ? idle.turnOutcome : null).toBe("failed");
  });

  test("ends the turn with the latest failure, not an earlier steer's end_turn", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    const first = sendText(harness, ref, "First");
    const firstPrompt = await harness.fake.waitForPrompts(1);
    firstPrompt.respond({ stopReason: "end_turn" });
    await first;
    await settle();
    const second = sendText(harness, ref, "Second");
    const secondPrompt = await harness.fake.waitForPrompts(2);
    await secondPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
    });
    await second;
    const steer = sendText(harness, ref, "Steer one", "steer");
    const steerPrompt = await harness.fake.waitForPrompts(3);
    // The earlier prompt answers at once when the runtime takes the steer.
    secondPrompt.respond({ stopReason: "end_turn" });
    await settle();
    await steerPrompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "More" } },
    });
    await steer;
    const lastSteer = sendText(harness, ref, "Steer two", "steer");
    const lastSteerPrompt = await harness.fake.waitForPrompts(4);

    steerPrompt.respond(RequestError.internalError(undefined, "Model failed"));
    await settle();
    lastSteerPrompt.respond(RequestError.invalidParams(undefined, "Steer refused"));
    await lastSteer.catch(() => undefined);
    await settle();

    const idle = harness.changes.flatMap((change) => change.events).at(-1);
    expect(idle?.type === "session_idle" ? idle.turnOutcome : null).toBe("failed");
  });

  test("refuses a steer when no turn runs", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);

    const refused = await sendText(harness, ref, "Steer", "steer").catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(AgentSessionMessageRefusedError);
  });

  test("shows a /compact turn as the session compaction, live and in history", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    const compact = () =>
      harness.controller.sendUserMessage({
        ...ref,
        parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
        delivery: "new_turn",
      });

    const sent = compact();
    const prompt = await harness.fake.waitForPrompts(1);
    const { messageId } = await sent;
    expect(prompt.params.prompt).toEqual([{ type: "text", text: "/compact" }]);
    // Antigravity sends no update while it compacts, so the end of the turn ends the compaction.
    prompt.respond({ stopReason: "end_turn" });
    await settle();

    const events = harness.changes.flatMap((change) => change.events);
    expect(events.find((event) => event.type === "session_compaction_started")).toMatchObject({
      messageId,
    });
    expect(events.find((event) => event.type === "session_compacted")).toMatchObject({
      messageId,
      message: "Session compacted.",
    });
    expect((await harness.controller.loadHistory(ref)).at(-1)).toMatchObject({
      messageId,
      role: "system",
      notice: { reason: "session_compacted" },
    });

    // A compaction that fails shows its `/compact` message again.
    const failed = compact();
    const failedPrompt = await harness.fake.waitForPrompts(2);
    const failedMessage = await failed;
    failedPrompt.respond(RequestError.internalError(undefined, "Compaction failed"));
    await settle();
    const lastMessage = harness.changes
      .flatMap((change) => change.events)
      .findLast((event) => event.type === "user_message");
    expect(lastMessage).toMatchObject({ messageId: failedMessage.messageId, message: "/compact" });
  });

  test("ends the turn with the reason when the runtime refuses the message that starts it", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);

    const sent = sendText(harness, ref, "Hello");
    const prompt = await harness.fake.waitForPrompts(1);
    await sent;
    prompt.respond(RequestError.invalidParams(undefined, "Bad prompt"));
    await settle();

    const events = harness.changes.flatMap((change) => change.events);
    expect(events.find((event) => event.type === "turn_error")).toMatchObject({
      message: expect.stringContaining("Bad prompt"),
    });
    expect(events.at(-1)).toMatchObject({ type: "session_idle", turnOutcome: "failed" });
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(false);
  });

  test("approves managed OpenDucktor tools and asks the user for other tools", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Work");
    const prompt = await harness.fake.waitForPrompts(1);
    const options: PermissionOption[] = [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ];

    // Antigravity names a tool of an MCP server from session/new mcp_<server>[_<hash>]_<tool>.
    for (const name of [
      "mcp_openducktor_session_odt_read_task",
      "mcp_openducktor_session_c324d862_odt_read_task",
    ]) {
      const managed = await prompt.client.request(methods.client.session.requestPermission, {
        sessionId: ref.externalSessionId,
        toolCall: {
          toolCallId: `mcp-${name}`,
          name,
          kind: "other",
          rawInput: { taskId: "task-1", toolSummary: "Read task task-1" },
        },
        options,
      });
      expect(managed.outcome).toEqual({ outcome: "selected", optionId: "allow" });
    }

    const pending = prompt.client.request(methods.client.session.requestPermission, {
      sessionId: ref.externalSessionId,
      toolCall: {
        toolCallId: "shell-1",
        kind: "execute",
        title: "ls",
        rawInput: { CommandLine: "ls" },
      },
      options,
    });
    await settle();
    const approval = lastSnapshot(harness)?.pendingApprovals[0];
    expect(approval?.command).toEqual({ command: "ls" });
    expect(approval?.supportedReplyOutcomes).toEqual(["approve_once", "reject"]);
    expect(lastSnapshot(harness)?.activity).toBe("waiting_for_permission");

    await harness.controller.replyApproval({
      ...ref,
      requestId: approval?.requestId ?? "",
      outcome: "reject",
    });
    expect((await pending).outcome).toEqual({ outcome: "selected", optionId: "deny" });
  });

  test("refuses file changes of a read-only role and approves its commands in the auto setting", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness, "qa");
    void sendText(harness, ref, "Review");
    const prompt = await harness.fake.waitForPrompts(1);

    const response = await prompt.client.request(methods.client.session.requestPermission, {
      sessionId: ref.externalSessionId,
      toolCall: { toolCallId: "edit-1", kind: "edit", title: "Edit file" },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    });

    expect(response.outcome).toEqual({ outcome: "selected", optionId: "deny" });
    expect(lastSnapshot(harness)?.pendingApprovals).toEqual([]);
    expect(eventTypes(harness)).toContain("session_policy_notice");

    // In the auto setting, the session runs in the native default mode and approves the commands.
    const command = await prompt.client.request(methods.client.session.requestPermission, {
      sessionId: ref.externalSessionId,
      toolCall: { toolCallId: "find-1", kind: "execute", title: "find . -name '*.ts'" },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    });
    expect(command.outcome).toEqual({ outcome: "selected", optionId: "allow" });
    expect(lastSnapshot(harness)?.pendingApprovals).toEqual([]);
    expect(
      harness.fake.modes.filter(({ sessionId }) => sessionId === ref.externalSessionId),
    ).toEqual([]);
  });

  test("shows the change of a file edit that waits for approval, but not of an append", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Edit");
    const prompt = await harness.fake.waitForPrompts(1);
    type EditInput = {
      Path: string;
      Target?: string;
      Replacement?: string;
      Content?: string;
      Append?: boolean;
    };
    const ask = async (toolCallId: string, name: string, rawInput: EditInput, oldText?: string) => {
      const toolCall = {
        toolCallId,
        name,
        kind: "edit" as const,
        title: "File notes.txt",
        rawInput,
      };
      await prompt.client.notify(methods.client.session.update, {
        sessionId: ref.externalSessionId,
        update: { sessionUpdate: "tool_call", status: "in_progress", ...toolCall },
      });
      void prompt.client.request(methods.client.session.requestPermission, {
        sessionId: ref.externalSessionId,
        toolCall: {
          ...toolCall,
          content: [
            { type: "diff", path: "/repo/notes.txt", newText: "four", ...(oldText && { oldText }) },
          ],
        },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      });
      await settle();
      const part = harness.changes
        .flatMap((change) => change.events)
        .findLast(
          (event) =>
            event.type === "assistant_part" &&
            event.part.kind === "tool" &&
            event.part.callId === toolCallId,
        );
      return part?.type === "assistant_part" && part.part.kind === "tool"
        ? part.part.fileDiffs
        : null;
    };

    expect(
      await ask(
        "edit-1",
        "edit_file",
        { Path: "/repo/notes.txt", Target: "three", Replacement: "four" },
        "three",
      ),
    ).toMatchObject([{ file: "/repo/notes.txt", type: "modified", additions: 1, deletions: 1 }]);
    // An append request has no earlier text, so it would look like a new file.
    expect(
      await ask("append-1", "write_file", {
        Path: "/repo/notes.txt",
        Content: "four",
        Append: true,
      }),
    ).toBeUndefined();
  });

  test("stops the exact session and closes its pending approvals", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Work");
    const prompt = await harness.fake.waitForPrompts(1);
    const pending = prompt.client.request(methods.client.session.requestPermission, {
      sessionId: ref.externalSessionId,
      toolCall: { toolCallId: "shell-1", kind: "execute", title: "sleep" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    await settle();

    const stopped = harness.controller.stopSession(ref);
    await settle();
    expect(harness.fake.cancelled).toEqual([ref.externalSessionId]);
    expect((await pending).outcome).toEqual({ outcome: "cancelled" });
    prompt.respond({ stopReason: "cancelled" });
    await stopped;

    const idle = harness.changes.flatMap((change) => change.events).at(-1);
    expect(idle?.type === "session_idle" ? idle.turnOutcome : null).toBe("interrupted");
    // The live notice and the history notice are the same row, so a reload keeps it.
    const interruption = idle?.type === "session_idle" ? idle.interruption : undefined;
    expect(interruption).toEqual({
      messageId: `${ref.externalSessionId}:t1:stopped`,
      message: "Session stopped at your request.",
    });
    expect((await harness.controller.loadHistory(ref)).at(-1)).toMatchObject({
      messageId: interruption?.messageId,
      role: "system",
      notice: { tone: "cancelled", reason: "session_interrupted" },
    });
  });

  test("keeps the session running while a command runs after its turn, and ends it with the command", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Run the checks");
    const prompt = await harness.fake.waitForPrompts(1);
    const update = (value: SessionUpdate) =>
      prompt.client.notify(methods.client.session.update, {
        sessionId: ref.externalSessionId,
        update: value,
      });
    const command = (toolCallId: string, CommandLine: string, IsDaemon = false) =>
      update({
        sessionUpdate: "tool_call",
        toolCallId,
        title: CommandLine,
        kind: "execute",
        status: "in_progress",
        name: "run_command",
        rawInput: { CommandLine, WaitMsBeforeAsync: 10000, IsDaemon },
      });
    await command("checks", "bun run test");
    // Antigravity does not wait for a daemon, so it does not keep the session running.
    await command("server", "bun run dev", true);
    prompt.respond({ stopReason: "end_turn" });
    await settle();

    expect(eventTypes(harness).at(-1)).toBe("session_turn_finished");
    expect(lastSnapshot(harness)).toMatchObject({
      activity: "running",
      foregroundTurnActive: false,
      backgroundTasks: [
        {
          taskId: "checks",
          kind: "command",
          title: "bun run test",
          stop: { allowed: false },
        },
      ],
    });

    await update({ sessionUpdate: "tool_call_update", toolCallId: "checks", status: "completed" });
    await settle();

    const idle = harness.changes.flatMap((change) => change.events).at(-1);
    expect(idle?.type).toBe("session_idle");
    expect(idle?.type === "session_idle" ? idle.turnOutcome : null).toBeUndefined();
    expect(lastSnapshot(harness)?.activity).toBe("idle");
    expect(lastSnapshot(harness)?.backgroundTasks).toBeUndefined();
  });

  test("stops the background commands of a session with no running turn", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Run the checks");
    const prompt = await harness.fake.waitForPrompts(1);
    await prompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "checks",
        title: "bun run test",
        kind: "execute",
        status: "in_progress",
        name: "run_command",
        rawInput: { CommandLine: "bun run test" },
      },
    });
    prompt.respond({ stopReason: "end_turn" });
    await settle();

    const stopped = harness.controller.stopSession(ref);
    await settle();
    expect(harness.fake.cancelled).toEqual([ref.externalSessionId]);
    await prompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "tool_call_update", toolCallId: "checks", status: "failed" },
    });
    await stopped;

    expect(eventTypes(harness).at(-1)).toBe("session_idle");
    expect(lastSnapshot(harness)?.activity).toBe("idle");
  });

  test("interrupts a running turn when the runtime stops, with the reason as its notice", async () => {
    const harness = await createConnectedController();
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Work");
    const prompt = await harness.fake.waitForPrompts(1);
    await prompt.client.notify(methods.client.session.update, {
      sessionId: ref.externalSessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } },
    });
    await settle();
    const history = await harness.controller.loadHistory(ref);

    const events = harness.controller.settleRuntime("The Antigravity runtime stopped.");

    const idle = events.at(-1);
    expect(idle).toMatchObject({
      type: "session_idle",
      turnOutcome: "interrupted",
      interruption: {
        messageId: `${ref.externalSessionId}:t1:stopped`,
        message: "The Antigravity runtime stopped.",
      },
    });
    expect(events.some((event) => event.type === "turn_error")).toBe(false);
    expect((await harness.controller.loadHistory(ref)).slice(history.length)).toMatchObject([
      { role: "system", text: "The Antigravity runtime stopped." },
    ]);
  });

  test("fails Stop with the reason when the runtime does not end the turn", async () => {
    const harness = await createConnectedController({ stopDeadlineMs: 20 });
    const { ref } = await startBuildSession(harness);
    void sendText(harness, ref, "Work");
    await harness.fake.waitForPrompts(1);

    const failure = await harness.controller.stopSession(ref).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("did not stop the turn");
    expect(harness.controller.hasRunningTurn(ref.externalSessionId)).toBe(true);
  });

  test("reads the history of a session that is not open, then closes it", async () => {
    const harness = await createConnectedController();
    harness.fake.sessions.push({ sessionId: "saved-1", cwd: "/repo/worktree" });
    harness.fake.replays.set("saved-1", [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Earlier" } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Answer" } },
    ]);

    const history = await harness.controller.loadHistory({
      repoPath: "/repo",
      runtimeKind: "antigravity",
      workingDirectory: "/repo/worktree",
      externalSessionId: "saved-1",
    });

    expect(harness.fake.loaded[0]?.mcpServers).toEqual([]);
    expect(harness.fake.loaded[0]?._meta).toBeUndefined();
    expect(harness.fake.closed).toEqual(["saved-1"]);
    expect(history.map((message) => [message.role, message.messageId, message.text])).toEqual([
      ["user", "saved-1:t1:user", "Earlier"],
      ["assistant", "saved-1:t1:i1", "Answer"],
    ]);
    expect(harness.controller.listSnapshots()).toEqual([]);
  });

  test("publishes the newest command list when it arrives during the model choice", async () => {
    const harness = await createConnectedController();
    harness.fake.sessions.push({ sessionId: "saved-1", cwd: "/repo/worktree" });
    harness.fake.replays.set("saved-1", [
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "old", description: "Old command." }],
      },
    ]);
    harness.fake.updatesOnConfig.push({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "new", description: "New command." }],
    });

    await harness.controller.reattachSession({
      repoPath: "/repo",
      runtimeKind: "antigravity",
      workingDirectory: "/repo/worktree",
      externalSessionId: "saved-1",
      sessionScope: workflowScope("build"),
      model: { runtimeKind: "antigravity", providerId: "antigravity", modelId: "gemini-pro" },
    });

    const catalogs = harness.changes.flatMap((change) =>
      change.slashCommands ? [change.slashCommands.catalog.commands.map(({ id }) => id)] : [],
    );
    expect(catalogs.at(-1)).toEqual(["antigravity:new"]);
  });

  test("publishes no reopened session before its saved model applies", async () => {
    const harness = await createConnectedController();
    harness.fake.sessions.push({ sessionId: "saved-1", cwd: "/repo/worktree" });
    harness.fake.updatesOnConfig.push({ sessionUpdate: "usage_update", used: 10, size: 1000 });

    const failure = await harness.controller
      .reattachSession({
        repoPath: "/repo",
        runtimeKind: "antigravity",
        workingDirectory: "/repo/worktree",
        externalSessionId: "saved-1",
        sessionScope: workflowScope("build"),
        model: { runtimeKind: "antigravity", providerId: "antigravity", modelId: "unknown-model" },
      })
      .catch((cause: unknown) => cause);

    expect(String(failure)).toContain("Unknown model 'unknown-model'.");
    expect(harness.changes.flatMap((change) => change.snapshots)).toEqual([]);
    expect(harness.controller.listSnapshots()).toEqual([]);
  });

  test("publishes a valid command list when Antigravity lists a name twice", async () => {
    const harness = await createConnectedController();
    harness.fake.sessions.push({ sessionId: "saved-1", cwd: "/repo/worktree" });
    harness.fake.replays.set("saved-1", [
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "grill-me", description: "Interview me to align on a plan." },
          { name: "goal", description: "Work toward a goal." },
          { name: "grill-me", description: "A relentless interview." },
        ],
      },
    ]);

    await harness.controller.reattachSession({
      repoPath: "/repo",
      runtimeKind: "antigravity",
      workingDirectory: "/repo/worktree",
      externalSessionId: "saved-1",
      sessionScope: workflowScope("build"),
    });

    const catalog = harness.changes.at(-1)?.slashCommands?.catalog;
    expect(slashCommandCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(catalog?.commands.map(({ id, description }) => [id, description])).toEqual([
      ["antigravity:grill-me", "Interview me to align on a plan."],
      ["antigravity:goal", "Work toward a goal."],
    ]);
  });

  test("reopens a saved session with its instructions, tools, and replayed transcript", async () => {
    const harness = await createConnectedController();
    harness.fake.sessions.push({ sessionId: "saved-1", cwd: "/repo/worktree", title: "Saved" });
    harness.fake.replays.set("saved-1", [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Earlier" } },
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "goal", description: "Work toward a goal." }],
      },
    ]);

    const summary = await harness.controller.reattachSession({
      repoPath: "/repo",
      runtimeKind: "antigravity",
      workingDirectory: "/repo/worktree",
      externalSessionId: "saved-1",
      sessionScope: workflowScope("build"),
      systemPrompt: "Build the task.",
    });

    expect(summary.status).toBe("idle");
    expect(summary.title).toBe("Saved");
    expect(harness.fake.loaded[0]?._meta).toEqual({
      antigravity: { systemPrompt: { append: "Build the task." } },
    });
    expect(harness.fake.loaded[0]?.mcpServers).toHaveLength(1);
    expect(harness.changes.at(-1)?.provenance).toBe("baseline");
    // The command list arrives during the load, so the setup publish carries it.
    expect(harness.changes.at(-1)?.slashCommands?.catalog.commands.map(({ id }) => id)).toEqual([
      "antigravity:goal",
    ]);
    const sent = sendText(
      harness,
      { ...summary, repoPath: "/repo", runtimeKind: "antigravity" },
      "Next",
    );
    const prompt = await harness.fake.waitForPrompts(1);
    prompt.respond({ stopReason: "end_turn" });
    await sent;
    await settle();
    const user = harness.changes
      .flatMap((change) => change.events)
      .find((event) => event.type === "user_message");
    expect(user?.type === "user_message" ? user.messageId : null).toBe("saved-1:t2:user");
  });

  test("generates a text in a closed session of an empty directory with the instructions", async () => {
    const harness = await createConnectedController();
    const generated = harness.controller.generateText(
      {
        repoPath: "/repo",
        model: {
          runtimeKind: "antigravity",
          providerId: "antigravity",
          modelId: "gemini-3.8-flash",
          variant: "low",
        },
        instructions: "Write a short title.",
        prompt: "Fix the login bug",
      },
      new AbortController().signal,
    );
    const prompt = await harness.fake.waitForPrompts(1);
    const created = harness.fake.created[0];
    expect(created?.mcpServers).toEqual([]);
    expect(created?._meta).toEqual({
      antigravity: { systemPrompt: { append: "Write a short title." } },
    });
    expect(existsSync(created?.cwd ?? "")).toBe(true);
    await prompt.client.notify(methods.client.session.update, {
      sessionId: prompt.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " Fix login " },
      },
    });
    prompt.respond({ stopReason: "end_turn" });

    expect(await generated).toBe("Fix login");
    expect(harness.fake.closed).toEqual([prompt.params.sessionId]);
    expect(existsSync(created?.cwd ?? "")).toBe(false);
    expect(harness.controller.listSnapshots()).toEqual([]);
  });

  test("fails a text generation when the model calls a tool", async () => {
    const harness = await createConnectedController();
    const generated = harness.controller.generateText(
      {
        repoPath: "/repo",
        model: {
          runtimeKind: "antigravity",
          providerId: "antigravity",
          modelId: "gemini-3.8-flash",
        },
        instructions: "Write a short title.",
        prompt: "Fix the login bug",
      },
      new AbortController().signal,
    );
    const prompt = await harness.fake.waitForPrompts(1);
    await prompt.client.notify(methods.client.session.update, {
      sessionId: prompt.params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "ls",
        kind: "execute",
        status: "pending",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.fake.cancelled).toEqual([prompt.params.sessionId]);
    prompt.respond({ stopReason: "cancelled" });

    await expect(generated).rejects.toThrow("Antigravity tried to use a tool");
    expect(harness.fake.closed).toEqual([prompt.params.sessionId]);
  });
});

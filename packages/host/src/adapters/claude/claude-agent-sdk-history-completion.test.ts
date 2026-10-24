import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";
import { claudeLiveHistoryContext, loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import { readClaudeTranscript } from "./claude-transcript-reader";

const sessionId = "00000000-0000-4000-8000-000000000001";
const completedAt = "2026-10-21T10:00:10.000Z";

const withCompletionTranscript = async (
  stopReason: string | null,
  run: (
    cwd: string,
    config: string,
    append: (rows: ClaudeProtocolObject[]) => Promise<void>,
  ) => Promise<void>,
  interruptedByShutdown = false,
  backgroundTaskId: string | null = "old-bash",
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-completion-"));
  try {
    const cwd = await realpath(root);
    const config = join(cwd, "config");
    const project = join(config, "projects", "native-project");
    await mkdir(project, { recursive: true });
    const base = { cwd, sessionId, isSidechain: false };
    const rows: ClaudeProtocolObject[] = [
      {
        ...base,
        type: "user",
        uuid: "user",
        parentUuid: null,
        timestamp: "2026-10-21T10:00:00.000Z",
        message: { role: "user", content: "Check the files" },
      },
      {
        ...base,
        type: "assistant",
        uuid: "bash-call",
        parentUuid: "user",
        timestamp: "2026-10-21T10:00:01.000Z",
        message: {
          id: "bash-response",
          role: "assistant",
          content: [{ type: "tool_use", id: "bash", name: "Bash", input: { command: "bun test" } }],
          stop_reason: "tool_use",
        },
      },
      {
        ...base,
        type: "user",
        uuid: "bash-launch",
        parentUuid: "bash-call",
        timestamp: "2026-10-21T10:00:02.000Z",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "bash", content: "Running in the background" },
          ],
        },
      },
      {
        ...base,
        type: "user",
        uuid: "notification",
        parentUuid: "bash-launch",
        timestamp: "2026-10-21T10:00:05.000Z",
        origin: { kind: "task-notification" },
        message: {
          role: "user",
          content:
            "<task-notification><task-id>other-task</task-id><status>completed</status></task-notification>",
        },
      },
      {
        ...base,
        type: "assistant",
        uuid: "final-text",
        parentUuid: "notification",
        timestamp: completedAt,
        effort: "xhigh",
        perTurnEffort: "xhigh",
        message: {
          id: "final-response",
          model: "claude-opus-5-5",
          role: "assistant",
          content: [{ type: "text", text: "The files are ready." }],
          stop_reason: stopReason,
        },
      },
    ];
    const backgroundLaunch = rows[2];
    if (backgroundTaskId && backgroundLaunch) {
      backgroundLaunch.toolUseResult = { backgroundTaskId };
    }
    if (interruptedByShutdown) {
      rows.push({
        ...base,
        type: "user",
        uuid: "interrupted",
        parentUuid: "final-text",
        timestamp: "2026-10-21T10:00:11.000Z",
        interruptedByShutdown: true,
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user]" }],
        },
      });
    }
    await writeFile(
      join(project, `${sessionId}.jsonl`),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
    await run(cwd, config, (rows) =>
      appendFile(
        join(project, `${sessionId}.jsonl`),
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

for (const storage of ["memory", "disk"] as const) {
  test(`restores the terminal reply after obsolete background launches with ${storage} storage`, async () => {
    await withCompletionTranscript("end_turn", async (cwd, config) => {
      const history = await Effect.runPromise(
        loadClaudeHistory(
          {
            repoPath: cwd,
            workingDirectory: cwd,
            externalSessionId: sessionId,
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
          },
          () => completedAt,
          undefined,
          { processEnv: { CLAUDE_CONFIG_DIR: config }, storage },
        ),
      );
      const final = history.at(-1);
      expect(final?.parts).toContainEqual({
        kind: "step",
        phase: "finish",
        reason: "stop",
        messageId: "final-response",
        partId: "final-response:finish",
      });
      expect(final).toMatchObject({
        messageId: "final-response",
        timestamp: completedAt,
        text: "The files are ready.",
        model: {
          providerId: "claude",
          modelId: "claude-opus-5-5",
          runtimeKind: "claude",
          variant: "xhigh",
        },
      });
    });
  });
}

test.each([
  { stopReason: null, activeTaskIds: [], interruptedByShutdown: false, completed: false },
  { stopReason: null, activeTaskIds: [], interruptedByShutdown: true, completed: false },
  { stopReason: "end_turn", activeTaskIds: [], interruptedByShutdown: true, completed: false },
  {
    stopReason: "end_turn",
    activeTaskIds: ["old-bash"],
    interruptedByShutdown: false,
    completed: true,
  },
])(
  "restores completion with stop $stopReason, shutdown $interruptedByShutdown, and active tasks $activeTaskIds",
  async ({ stopReason, activeTaskIds, interruptedByShutdown, completed }) => {
    await withCompletionTranscript(
      stopReason,
      async (cwd, config) => {
        const history = await Effect.runPromise(
          loadClaudeHistory(
            {
              repoPath: cwd,
              workingDirectory: cwd,
              externalSessionId: sessionId,
              runtimeKind: "claude",
              runtimePolicy: { kind: "claude" },
            },
            () => completedAt,
            {
              activeBackgroundTaskIds: () => new Set(activeTaskIds),
              hasActiveWork: () => true,
              source: "persisted",
              userMessages: [],
            },
            { processEnv: { CLAUDE_CONFIG_DIR: config } },
          ),
        );
        expect(
          history.at(-1)?.parts.some((part) => part.kind === "step" && part.phase === "finish"),
        ).toBe(completed);
      },
      interruptedByShutdown,
    );
  },
);

test.each(["root", "nested"])(
  "keeps a terminal task reply complete without a fork while a live %s subagent runs",
  async (scope) => {
    await withCompletionTranscript("end_turn", async (cwd, config) => {
      const input = {
        repoPath: cwd,
        workingDirectory: cwd,
        externalSessionId: sessionId,
        runtimeKind: "claude" as const,
        runtimePolicy: { kind: "claude" as const },
      };
      const session = createClaudeSession({
        externalSessionId: sessionId,
        input: { ...input, sessionScope: { kind: "workflow", taskId: "task-1", role: "build" } },
      });
      session.activity = "running";
      if (scope === "root") {
        session.activeBackgroundSubagentTaskIds = new Set(["live-agent"]);
      } else {
        session.subagentTaskIdsByToolUseId.set("child-call", "child");
        const child = claudeSubagentEventSession(session, "child-call");
        if (!child) throw new Error("Expected the child event session.");
        child.activeBackgroundSubagentTaskIds = new Set(["live-grandchild"]);
      }
      const history = await Effect.runPromise(
        loadClaudeHistory(input, () => completedAt, claudeLiveHistoryContext(session), {
          processEnv: { CLAUDE_CONFIG_DIR: config },
        }),
      );
      expect(history.at(-1)?.parts).toContainEqual(
        expect.objectContaining({ kind: "step", phase: "finish" }),
      );
      expect(history.at(-1)).not.toHaveProperty("forkPoint");
    });
  },
);

test("keeps an earlier reply and starts a new clock after shutdown", async () => {
  await withCompletionTranscript("end_turn", async (cwd, config, append) => {
    const base = { cwd, sessionId, isSidechain: false, type: "user" };
    await append([
      {
        ...base,
        uuid: "next-user",
        parentUuid: "final-text",
        timestamp: "2026-10-21T10:00:11.000Z",
        message: { role: "user", content: "Check the next file" },
      },
      {
        ...base,
        type: "assistant",
        uuid: "interrupted-assistant",
        parentUuid: "next-user",
        timestamp: "2026-10-21T10:00:11.500Z",
        message: {
          id: "interrupted-response",
          role: "assistant",
          content: [{ type: "text", text: "A partial reply" }],
          stop_reason: "end_turn",
        },
      },
      {
        ...base,
        uuid: "next-shutdown",
        parentUuid: "interrupted-assistant",
        timestamp: "2026-10-21T10:00:12.000Z",
        interruptedByShutdown: true,
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user]" }],
        },
      },
      {
        ...base,
        uuid: "resumed-user",
        parentUuid: "next-shutdown",
        timestamp: "2026-10-21T10:00:13.000Z",
        message: { role: "user", content: "Continue with the next file" },
      },
      {
        ...base,
        type: "assistant",
        uuid: "resumed-assistant",
        parentUuid: "resumed-user",
        timestamp: "2026-10-21T10:00:14.000Z",
        message: {
          id: "resumed-response",
          role: "assistant",
          content: [{ type: "text", text: "The next file is checked." }],
          stop_reason: "end_turn",
        },
      },
    ]);
    const history = await Effect.runPromise(
      loadClaudeHistory(
        {
          repoPath: cwd,
          workingDirectory: cwd,
          externalSessionId: sessionId,
          runtimeKind: "claude",
          runtimePolicy: { kind: "claude" },
        },
        () => completedAt,
        undefined,
        { processEnv: { CLAUDE_CONFIG_DIR: config } },
      ),
    );
    expect(history.at(-1)).toMatchObject({ messageId: "resumed-response", durationMs: 1_000 });
    const earlierReply = history.find((message) => message.messageId === "final-response");
    expect(earlierReply?.parts).toContainEqual(
      expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" }),
    );
  });
});

test.each([{ backgroundTaskId: null }, { backgroundTaskId: "old-bash" }])(
  "keeps an earlier terminal reply when a new prompt starts during its native read with background launch $backgroundTaskId",
  async ({ backgroundTaskId }) => {
    await withCompletionTranscript(
      "end_turn",
      async (cwd, config) => {
        const input = {
          repoPath: cwd,
          workingDirectory: cwd,
          externalSessionId: sessionId,
          runtimeKind: "claude" as const,
          runtimePolicy: { kind: "claude" as const },
        };
        const session = createClaudeSession({
          externalSessionId: sessionId,
          input: { ...input, sessionScope: { kind: "workflow", taskId: "task-1", role: "build" } },
        });
        const liveContext = claudeLiveHistoryContext(session);
        const history = await Effect.runPromise(
          loadClaudeHistory(input, () => completedAt, liveContext, {
            reader: {
              read: (target) =>
                readClaudeTranscript(target, { processEnv: { CLAUDE_CONFIG_DIR: config } }).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      session.acceptedUserMessages.push({
                        messageId: "new-prompt",
                        text: "Check the next file",
                        timestamp: "2026-10-21T10:00:11.000Z",
                        parts: [],
                      });
                      session.backgroundToolActiveTaskIds = new Set(["new-task"]);
                      session.pendingUserTurnCount = 1;
                    }),
                  ),
                ),
            },
          }),
        );
        const earlierReply = history.find((message) => message.messageId === "final-response");
        expect(earlierReply?.parts).toContainEqual(
          expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" }),
        );
        expect(earlierReply).toMatchObject({
          model: { modelId: "claude-opus-5-5", variant: "xhigh" },
        });
        expect(history.at(-1)).toMatchObject({ messageId: "new-prompt", role: "user", parts: [] });
      },
      false,
      backgroundTaskId,
    );
  },
);

test.each([false, true])(
  "keeps prior completed replies after a new unfinished prompt, later wake %s",
  async (laterWake) => {
    await withCompletionTranscript("end_turn", async (cwd, config, append) => {
      const base = { cwd, sessionId, isSidechain: false };
      const rows: ClaudeProtocolObject[] = [];
      if (laterWake) {
        rows.push(
          {
            ...base,
            type: "user",
            uuid: "later-notification",
            parentUuid: "final-text",
            timestamp: "2026-10-21T10:00:10.100Z",
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content:
                "<task-notification><task-id>last-task</task-id><status>completed</status></task-notification>",
            },
          },
          {
            ...base,
            type: "assistant",
            uuid: "closing-text",
            parentUuid: "later-notification",
            timestamp: "2026-10-21T10:00:10.500Z",
            effort: "xhigh",
            message: {
              id: "closing-response",
              role: "assistant",
              model: "claude-opus-5-5",
              content: [{ type: "text", text: "All checks are done." }],
              stop_reason: "end_turn",
            },
          },
        );
      }
      rows.push(
        {
          ...base,
          type: "user",
          uuid: "next-user",
          parentUuid: laterWake ? "closing-text" : "final-text",
          timestamp: "2026-10-21T10:00:11.000Z",
          origin: { kind: "human" },
          message: { role: "user", content: "Check the next file" },
        },
        {
          ...base,
          type: "assistant",
          uuid: "next-tool",
          parentUuid: "next-user",
          timestamp: "2026-10-21T10:00:12.000Z",
          message: {
            id: "next-response",
            role: "assistant",
            content: [
              { type: "tool_use", id: "next-read", name: "Read", input: { file_path: "next.ts" } },
            ],
            stop_reason: "tool_use",
          },
        },
      );
      await append(rows);
      const history = await Effect.runPromise(
        loadClaudeHistory(
          {
            repoPath: cwd,
            workingDirectory: cwd,
            externalSessionId: sessionId,
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
          },
          () => completedAt,
          undefined,
          { processEnv: { CLAUDE_CONFIG_DIR: config } },
        ),
      );
      const terminalId = laterWake ? "closing-response" : "final-response";
      const terminal = history.find((message) => message.messageId === terminalId);
      expect(terminal?.parts).toContainEqual(
        expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" }),
      );
      if (terminal?.role !== "assistant") throw new Error("Expected the prior terminal reply.");
      expect(terminal.model).toMatchObject({ modelId: "claude-opus-5-5", variant: "xhigh" });
      expect(history.at(-1)).toMatchObject({
        messageId: "next-response",
        parts: [expect.objectContaining({ kind: "tool", status: "running" })],
      });
      if (laterWake) {
        expect(
          history.find((message) => message.messageId === "final-response")?.parts,
        ).toContainEqual(expect.objectContaining({ kind: "step", phase: "finish" }));
      }
    });
  },
);

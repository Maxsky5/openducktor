import { describe, expect, test } from "bun:test";
import type {
  SessionMessageAssistant,
  SessionMessageShell,
  SessionMessageSynthetic,
} from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessages } from "./opencode-message-projection";
import { durable } from "./opencode-v2-live.test-support";
import { model, ref } from "./opencode-v2.test-support";

const command = 'printf "one > two"\nbun run test';
const output = '54 tests passed\n<shell id="output-is-not-a-message">';
const makeNotice = (
  metadata: Record<string, string | number | boolean> = {},
): SessionMessageSynthetic => ({
  id: "msg_shell_completed",
  type: "synthetic",
  time: { created: 10 },
  description: command,
  text: `<shell id="job_checks" state="${metadata.state ?? "completed"}" command="${command}">\n${output}\n</shell>`,
  metadata: {
    source: "shell",
    shellID: "sh_checks",
    jobID: "job_checks",
    state: "completed",
    exit: 0,
    ...metadata,
  },
});

const launch = (): SessionMessageAssistant => ({
  id: "msg_launch",
  type: "assistant",
  agent: "build",
  model,
  time: { created: 1, completed: 5 },
  content: [
    {
      type: "tool",
      id: "call_checks",
      name: "shell",
      time: { created: 2, ran: 3, completed: 4 },
      state: {
        status: "completed",
        input: { command, background: true },
        content: [{ type: "text", text: "Command moved to the background" }],
        metadata: { shellID: "sh_checks", status: "running", truncated: false },
      },
    },
  ],
});

describe("OpenCode V2 shell projection", () => {
  test("shows an unlinked shell result as a tool card without its context wrapper", () => {
    const history = projectMessages([makeNotice()]);
    expect(history).toMatchObject([
      {
        messageId: "msg_shell_completed",
        role: "assistant",
        text: "",
        parts: [
          {
            kind: "tool",
            toolType: "bash",
            status: "completed",
            input: { command },
            output,
            endedAtMs: 10,
          },
        ],
      },
    ]);
    expect(history[0]?.parts[0]).not.toHaveProperty("startedAtMs");
  });

  test.each([
    {
      metadata: { state: "completed", exit: 0 },
      status: "completed",
      outcome: "completed",
      error: undefined,
    },
    {
      metadata: { state: "completed", exit: 1 },
      status: "error",
      outcome: "failed",
      error: "Shell command exited with code 1.",
    },
    { metadata: { state: "cancelled" }, status: "error", outcome: "stopped", error: output },
    { metadata: { state: "error" }, status: "error", outcome: "failed", error: output },
    {
      metadata: { state: "completed", timeout: true },
      status: "error",
      outcome: "failed",
      error: "Shell command timed out.",
    },
    {
      metadata: { state: "completed", signal: "SIGTERM" },
      status: "error",
      outcome: "failed",
      error: "Shell command was killed by SIGTERM.",
    },
  ])(
    "settles the original background call for $metadata",
    ({ metadata, status, outcome, error }) => {
      const message = launch();
      expect(projectMessages([message])[0]?.parts[0]).toMatchObject({
        status: "running",
        startedAtMs: 3,
      });
      expect(projectMessages([message])[0]?.parts[0]).not.toHaveProperty("endedAtMs");
      const history = projectMessages([message, makeNotice(metadata)]);
      expect(history).toHaveLength(1);
      expect(history[0]?.parts).toMatchObject([
        {
          partId: "call_checks",
          callId: "call_checks",
          status,
          output,
          resultContent: [{ kind: "text", text: output }],
          startedAtMs: 3,
          endedAtMs: 10,
          metadata: { shellID: "sh_checks", backgroundTaskStatus: outcome },
        },
      ]);
      if (error === undefined) expect(history[0]?.parts[0]).not.toHaveProperty("error");
      else expect(history[0]?.parts[0]).toHaveProperty("error", error);
    },
  );

  test("matches identical commands by native shell ID", () => {
    const other = launch();
    other.id = "msg_other_launch";
    const call = other.content[0];
    if (call?.type !== "tool" || call.state.status !== "completed")
      throw new Error("Expected a completed background launch");
    call.id = "call_other_checks";
    call.state.metadata = { shellID: "sh_other_checks", status: "running" };
    const history = projectMessages([launch(), other, makeNotice()]);
    expect(history).toHaveLength(2);
    expect(history[0]?.parts[0]).toMatchObject({
      partId: "call_checks",
      status: "completed",
      output,
    });
    expect(history[1]?.parts[0]).toMatchObject({ partId: "call_other_checks", status: "running" });
  });

  test("updates the original card from a live synthetic event and restores the same result", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.seed([launch()]);
    const notice = makeNotice({ truncated: true });
    const events = projector.apply({
      id: "evt_shell_completed",
      type: "session.synthetic",
      created: notice.time.created,
      durable,
      data: {
        sessionID: ref.externalSessionId,
        text: notice.text,
        description: notice.description,
        metadata: notice.metadata,
      },
    });
    expect(events).toMatchObject([
      {
        type: "assistant_part",
        part: {
          partId: "call_checks",
          status: "completed",
          output: `${output}\nNative output was truncated.`,
          endedAtMs: 10,
        },
      },
    ]);
    const restored = new OpenCodeLiveMessageProjector();
    restored.seed([launch(), notice]);
    expect(restored.snapshotEvents(ref.externalSessionId)).toEqual(
      projector.snapshotEvents(ref.externalSessionId),
    );
    expect(projector.projectHistory([launch()])[0]?.parts[0]).toMatchObject({
      status: "completed",
      endedAtMs: 10,
    });
  });

  test("keeps user shell output on one stable card instead of repeating its synthetic delivery", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const shell = {
      id: "sh_checks",
      command,
      status: "running" as const,
      cwd: "/repo",
      shell: "/bin/zsh",
      file: "/repo/shell-output.txt",
      metadata: { background: true },
      time: { started: 2 },
    };
    const started = projector.apply({
      id: "evt_user_shell",
      type: "session.shell.started",
      created: 2,
      durable,
      data: { sessionID: ref.externalSessionId, shell },
    });
    expect(started).toMatchObject([
      { type: "assistant_part", part: { partId: "msg_user_shell:shell", status: "running" } },
    ]);
    const runningHistory = structuredClone([...projector.messages.values()]);
    const ended = projector.apply({
      id: "evt_user_shell_ended",
      type: "session.shell.ended",
      created: 9,
      durable: { ...durable, seq: 2 },
      data: {
        sessionID: ref.externalSessionId,
        shell: { ...shell, status: "exited", exit: 1, time: { started: 2, completed: 9 } },
        output: { output, size: output.length, cursor: output.length, truncated: true },
      },
    });
    expect(ended).toMatchObject([
      {
        type: "assistant_part",
        part: {
          partId: "msg_user_shell:shell",
          status: "error",
          output: `${output}\nNative output was truncated.`,
          startedAtMs: 2,
          endedAtMs: 9,
        },
      },
    ]);
    expect(projector.projectHistory(runningHistory)[0]?.parts[0]).toMatchObject({
      status: "error",
      output: `${output}\nNative output was truncated.`,
      endedAtMs: 9,
    });
    expect(
      projector.apply({
        id: "evt_user_shell_context",
        type: "session.synthetic",
        created: 10,
        durable: { ...durable, seq: 3 },
        data: {
          sessionID: ref.externalSessionId,
          text: `The following shell command was executed by the user:\n<shell id="sh_checks" state="completed" command="${command}">\n${output}\n\nExited with code 1\n</shell>`,
          metadata: { source: "shell", shellID: "sh_checks", state: "completed", exit: 1 },
        },
      }),
    ).toEqual([]);
    expect(projector.projectHistory([...projector.messages.values()])).toHaveLength(1);
  });

  test.each(["history", "live"] as const)(
    "keeps user shell signal failures and structured output in %s",
    (mode) => {
      const shell: SessionMessageShell = {
        id: "msg_user_signal",
        type: "shell",
        shellID: "sh_user_signal",
        command: "kill -TERM $$",
        status: "exited",
        time: { created: 2, completed: 9 },
        output: { output, size: output.length, cursor: output.length, truncated: false },
      };
      const notice: SessionMessageSynthetic = {
        id: "msg_user_signal_notice",
        type: "synthetic",
        time: { created: 10 },
        text: 'The following shell command was executed by the user:\n<shell id="sh_user_signal" state="completed" command="kill -TERM $$">\nCaptured tail\n\nKilled by SIGTERM\n</shell>',
        metadata: {
          source: "shell",
          shellID: "sh_user_signal",
          state: "completed",
          signal: "SIGTERM",
          truncated: true,
        },
      };
      const expectedPart = {
        kind: "tool",
        partId: "msg_user_signal:shell",
        callId: "sh_user_signal",
        status: "error",
        error: "Shell command was killed by SIGTERM.",
        output,
        resultContent: [{ kind: "text", text: output }],
        startedAtMs: 2,
        endedAtMs: 9,
        metadata: { signal: "SIGTERM", backgroundTaskStatus: "failed", truncated: false },
      };
      if (mode === "history") {
        const history = projectMessages([shell, notice]);
        expect(history).toHaveLength(1);
        expect(history[0]?.parts).toMatchObject([expectedPart]);
        return;
      }
      const projector = new OpenCodeLiveMessageProjector();
      projector.seed([shell]);
      const events = projector.apply({
        id: "evt_user_signal_notice",
        type: "session.synthetic",
        created: notice.time.created,
        durable,
        data: { sessionID: ref.externalSessionId, text: notice.text, metadata: notice.metadata },
      });
      expect(events).toMatchObject([{ type: "assistant_part", part: expectedPart }]);
      expect(projector.projectHistory([shell])[0]?.parts).toMatchObject([expectedPart]);
      const restored = new OpenCodeLiveMessageProjector();
      restored.seed([shell, notice]);
      expect(restored.snapshotEvents(ref.externalSessionId)).toEqual(
        projector.snapshotEvents(ref.externalSessionId),
      );
    },
  );

  test("keeps shell launch failures visible and rejects malformed known result envelopes", () => {
    expect(
      projectMessages([
        {
          id: "msg_start_failed",
          type: "synthetic",
          time: { created: 1 },
          description: command,
          text: "User shell command failed to start: directory does not exist.",
          metadata: { source: "shell", state: "error" },
        },
      ])[0]?.parts[0],
    ).toMatchObject({
      status: "error",
      error: "User shell command failed to start: directory does not exist.",
    });
    expect(() => projectMessages([{ ...makeNotice(), text: "Broken envelope" }])).toThrow(
      "Check the command output in OpenCode",
    );
    expect(() => projectMessages([makeNotice({ state: "unknown" })])).toThrow(
      "Check the command in OpenCode",
    );
  });
});

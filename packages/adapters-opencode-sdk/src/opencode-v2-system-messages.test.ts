import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { messageEvents, projectMessages } from "./opencode-message-projection";
import { durable } from "./opencode-v2-live.test-support";
import { model, ref } from "./opencode-v2.test-support";

describe("OpenCode V2 system content", () => {
  test("shows activated skills as tool cards with their full content available", () => {
    const message: SessionMessageInfo = {
      id: "msg_skill",
      type: "skill",
      skill: "native.review",
      name: "review",
      text: "# Review instructions\n\nCheck the native contract.",
      time: { created: 2 },
    };
    expect(projectMessages([message])).toMatchObject([
      {
        role: "assistant",
        text: "",
        parts: [
          {
            kind: "tool",
            tool: "skill",
            status: "completed",
            input: { name: "review" },
            output: message.text,
          },
        ],
      },
    ]);
    const live = new OpenCodeLiveMessageProjector();
    const events = live.apply({
      id: "evt_skill",
      type: "session.skill.activated",
      created: 2,
      durable,
      data: {
        sessionID: ref.externalSessionId,
        id: message.skill,
        name: message.name,
        text: message.text,
      },
    });
    const restored = new OpenCodeLiveMessageProjector();
    restored.seed([message]);
    expect(events).toEqual(restored.snapshotEvents(ref.externalSessionId));
  });

  test("keeps the instructions that OpenCode gives the model out of the transcript", () => {
    const loaded: SessionMessageInfo = {
      id: "msg_loaded_instructions",
      type: "synthetic",
      time: { created: 3 },
      description: "Loaded packages/AGENTS.md",
      text: "Instructions from: /repo/packages/AGENTS.md\nUse the package rules.",
      metadata: { instruction: { paths: ["/repo/packages/AGENTS.md"] } },
    };
    const updated: SessionMessageInfo = {
      id: "msg_instructions_updated",
      type: "system",
      time: { created: 4 },
      description: "Instructions updated: core/date",
      text: "Today is Wednesday.",
      metadata: { notice: "instructions", instructionSources: ["core/date"] },
    };
    expect(projectMessages([loaded, updated])).toEqual([]);
    const live = new OpenCodeLiveMessageProjector();
    expect(
      live.apply({
        id: "evt_loaded_instructions",
        type: "session.synthetic",
        created: 3,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          text: loaded.text,
          description: loaded.description,
          metadata: loaded.metadata,
        },
      }),
    ).toEqual([]);
    expect(
      live.apply({
        id: "evt_instructions_updated",
        type: "session.instructions.updated",
        created: 4,
        durable: { ...durable, seq: 2 },
        data: {
          sessionID: ref.externalSessionId,
          text: updated.text,
          delta: { "core/date": "Today is Wednesday." },
        },
      }),
    ).toEqual([]);
  });

  test("shows a prompt of an OpenCode automation as a prompt from that automation", () => {
    const metadata = {
      automation: { id: "aut_1", name: "Nightly check", run: 1, dueAt: 5, late: false },
    };
    const origin = { kind: "automation", name: "Nightly check" };
    const prompt: SessionMessageInfo = {
      id: "msg_automation",
      type: "user",
      text: "Run the checks.",
      metadata,
      time: { created: 5 },
    };
    expect(projectMessages([prompt])).toMatchObject([
      { messageId: "msg_automation", role: "user", text: "Run the checks.", origin },
    ]);
    // OpenCode accepts a blank automation name, which gives the prompt no origin.
    const blank = { ...prompt, metadata: { automation: { ...metadata.automation, name: "  " } } };
    expect(projectMessages([blank])[0]).not.toHaveProperty("origin");

    const projector = new OpenCodeLiveMessageProjector();
    expect(
      projector.apply(
        {
          id: "evt_automation_enqueued",
          created: 5,
          type: "session.inbox.enqueued",
          durable,
          data: {
            sessionID: ref.externalSessionId,
            inboxID: "msg_automation",
            item: {
              type: "user",
              delivery: "steer",
              payload: { text: "Run the checks.", metadata },
            },
          },
        },
        true,
      ),
    ).toMatchObject([{ type: "user_message", messageId: "msg_automation", state: "read", origin }]);
    expect(
      projector.apply({
        id: "evt_automation_delivered",
        created: 6,
        type: "session.inbox.delivered",
        durable: { ...durable, seq: 2 },
        data: { sessionID: ref.externalSessionId, inboxID: "msg_automation" },
      }),
    ).toMatchObject([{ type: "user_message", messageId: "msg_automation", state: "read", origin }]);
  });

  test("shows a described notice under its description, as the OpenCode timeline does", () => {
    const notice: SessionMessageInfo = {
      id: "msg_watch",
      type: "synthetic",
      time: { created: 7 },
      description: "CI failed on main",
      text: "The watched CI run failed. Read the log, then fix the build.",
      metadata: { source: "console.watch", events: ["evt_ci"] },
    };
    expect(projectMessages([notice])).toEqual([
      {
        messageId: "msg_watch",
        timestamp: new Date(7).toISOString(),
        role: "system",
        title: "CI failed on main",
        text: notice.text,
        parts: [],
      },
    ]);
    expect(messageEvents(ref.externalSessionId, notice)).toMatchObject([
      {
        type: "session_policy_notice",
        messageId: "msg_watch",
        title: "CI failed on main",
        message: notice.text,
      },
    ]);
  });

  test("hides records that the transcript shows elsewhere or that only the model reads", () => {
    const location = { directory: "/repo" };
    const messages: SessionMessageInfo[] = [
      // A goal continuation, a Plan reminder, and a background request have no description.
      {
        id: "msg_goal_continue",
        type: "synthetic",
        time: { created: 1 },
        text: "Continue working toward the goal.",
        metadata: { source: "goal", goalID: "goal_1" },
      },
      { id: "msg_plan", type: "synthetic", time: { created: 2 }, text: "Plan mode is active." },
      {
        id: "msg_fork_notice_ses_saved",
        type: "synthetic",
        time: { created: 3 },
        description: "Fork notice",
        text: "<fork-notice>You work in a fork.</fork-notice>",
      },
      { id: "msg_model", type: "model-switched", time: { created: 4 }, model },
      { id: "msg_location", type: "location-switched", time: { created: 5 }, location },
      // A failed reply already shows its error.
      {
        id: "msg_failed_reply",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 6, completed: 7 },
        error: { type: "provider", message: "Rate limited" },
        content: [],
      },
      {
        id: "msg_failed_turn",
        type: "idle",
        outcome: "failed",
        error: { type: "provider", message: "Rate limited" },
        time: { created: 8 },
      },
      // A synthetic error notice with no description still shows.
      {
        id: "msg_job_error",
        type: "synthetic",
        time: { created: 9 },
        text: "The job failed.",
        metadata: { source: "plugin", state: "error" },
      },
    ];
    expect(projectMessages(messages).map((message) => message.messageId)).toEqual([
      "msg_failed_reply",
      "msg_job_error",
    ]);
  });

  test("keeps unknown notices and user text that looks like shell markup", () => {
    const text =
      '<background-result kind="shell" id="sh_checks" state="completed" command="bun run test">\nVisible example\n</background-result>';
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_plugin",
        type: "synthetic",
        time: { created: 1 },
        description: "Plugin notice",
        text,
        metadata: { source: "plugin" },
      },
      { id: "msg_user", type: "user", time: { created: 2 }, text },
    ];
    expect(projectMessages(messages)).toMatchObject([
      { messageId: "msg_plugin", role: "system", text },
      { messageId: "msg_user", role: "user", text },
    ]);
  });
});

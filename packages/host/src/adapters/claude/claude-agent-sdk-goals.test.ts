import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import {
  beginClaudeGoalCommand,
  forgetEndedClaudeGoal,
  observeClaudeGoalFrame,
  readClaudeSessionGoal,
  restoreClaudeGoalFromRecords,
  restoreClaudeSessionGoal,
} from "./claude-agent-sdk-goals";
import type { ClaudeGoalEvent, ClaudeSessionContext } from "./claude-agent-sdk-types";

const OBJECTIVE = "All tests pass";

/** An SDK stream frame with the fields that the goal observer reads. */
type ClaudeFrameFixture = ClaudeProtocolObject;
const SESSION_ID = "6f4b8d1e-0c2a-4f3e-9a7b-1d2c3e4f5a6b";

const goalRecord = (
  uuid: string,
  parentUuid: string | null,
  fields: { met: boolean; sentinel?: true; failed?: true; condition?: string },
): ClaudeProtocolObject => ({
  type: "attachment",
  uuid,
  parentUuid,
  attachment: { type: "goal_status", condition: OBJECTIVE, ...fields },
});
const message = (
  type: "user" | "assistant",
  uuid: string,
  parentUuid: string | null,
): ClaudeProtocolObject => ({ type, uuid, parentUuid, message: { content: "text" } });
const boundary = (uuid: string): ClaudeProtocolObject => ({
  type: "system",
  subtype: "compact_boundary",
  uuid,
  parentUuid: null,
  logicalParentUuid: "u1",
});

describe("restoreClaudeGoalFromRecords", () => {
  test("restores an unfinished goal of the active chain", () => {
    expect(
      restoreClaudeGoalFromRecords([
        message("user", "u1", null),
        goalRecord("g1", "u1", { met: false, sentinel: true }),
        message("assistant", "a1", "g1"),
        goalRecord("g2", "a1", { met: false }),
        message("user", "u2", "g2"),
      ]),
    ).toEqual({ objective: OBJECTIVE, ended: false });
  });

  test.each([
    ["met", { met: true }],
    ["failed", { met: false, failed: true }],
    ["cleared", { met: true, sentinel: true }],
  ] as const)("does not restore a %s goal", (_, fields) => {
    expect(
      restoreClaudeGoalFromRecords([
        goalRecord("g1", null, { met: false, sentinel: true }),
        goalRecord("g2", "g1", fields),
        message("user", "u1", "g2"),
      ]),
    ).toBeNull();
  });

  test("stops at a compact boundary and never follows its logical parent", () => {
    expect(
      restoreClaudeGoalFromRecords([
        message("user", "u1", null),
        goalRecord("g1", "u1", { met: false, sentinel: true }),
        boundary("b1"),
        message("user", "u2", "b1"),
      ]),
    ).toBeNull();
  });

  test("ignores a goal on a branch that the leaf does not reach", () => {
    expect(
      restoreClaudeGoalFromRecords([
        message("user", "u1", null),
        goalRecord("g1", "u1", { met: false, sentinel: true }),
        message("assistant", "a2", "u1"),
        { ...message("assistant", "s1", "g1"), isSidechain: true },
      ]),
    ).toBeNull();
  });
});

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const createSession = async (records: ClaudeProtocolObject[] = []) => {
  const configDirectory = await mkdtemp(join(tmpdir(), "claude-goal-"));
  directories.push(configDirectory);
  const projectDirectory = join(configDirectory, "projects", "-repo");
  await mkdir(projectDirectory, { recursive: true });
  const path = join(projectDirectory, `${SESSION_ID}.jsonl`);
  await writeFile(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
  const session: Pick<ClaudeSessionContext, "externalSessionId" | "goalTracking"> & {
    transcriptEnvironment: NodeJS.ProcessEnv;
  } = {
    externalSessionId: SESSION_ID,
    transcriptEnvironment: { CLAUDE_CONFIG_DIR: configDirectory },
  };
  const events: ClaudeGoalEvent[] = [];
  const failures: Error[] = [];
  const observe = (frame: ClaudeFrameFixture) =>
    observeClaudeGoalFrame({
      session,
      // SAFETY: The observer reads frames through its own schemas, like live SDK frames.
      message: frame as SDKMessage,
      now: () => "2026-11-07T10:00:00.000Z",
      emit: (event) => events.push(event),
      onFailure: (error) => failures.push(error),
    });
  const append = (record: ClaudeProtocolObject) => appendFile(path, `${JSON.stringify(record)}\n`);
  const settled = () => session.goalTracking?.reads;
  return { session, events, failures, observe, append, settled, path };
};

const goalReply = (args: string, text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  local_command_run: { command: "goal", args },
  message: { model: "<synthetic>", content: [{ type: "text", text }] },
});
const modelFrame = { type: "assistant", parent_tool_use_id: null, message: { content: [] } };
const result = { type: "result", subtype: "success" };

describe("Claude goal commands", () => {
  test("a set settles at the first model frame, before Claude writes its record", async () => {
    const { session, observe, append, events } = await createSession([message("user", "u1", null)]);
    const wait = beginClaudeGoalCommand(session, { kind: "set", objective: OBJECTIVE });
    observe(goalReply(OBJECTIVE, `Goal set: ${OBJECTIVE}`));
    observe(modelFrame);
    await wait.outcome;
    expect(readClaudeSessionGoal(session)).toEqual({ objective: OBJECTIVE, ended: false });
    expect(events).toEqual([
      expect.objectContaining({ goal: { objective: OBJECTIVE, ended: false } }),
    ]);

    // The record that Claude writes later changes nothing.
    await append(goalRecord("g1", "u1", { met: false, sentinel: true }));
    observe(result);
    await session.goalTracking?.reads;
    expect(events).toHaveLength(1);
  });

  test("a set without a record at the turn result fails with the command reply", async () => {
    const { session, observe } = await createSession();
    const wait = beginClaudeGoalCommand(session, { kind: "set", objective: OBJECTIVE });
    const reason = "/goal can't run while hooks are restricted.";
    observe(goalReply(OBJECTIVE, reason));
    observe(result);
    const failure = await wait.outcome.then(() => null).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", reason);
    expect(readClaudeSessionGoal(session)).toBeNull();
  });

  test("a set whose turn ends before the model answers finds its record at the result", async () => {
    const { session, observe, append } = await createSession();
    const wait = beginClaudeGoalCommand(session, { kind: "set", objective: OBJECTIVE });
    observe(goalReply(OBJECTIVE, `Goal set: ${OBJECTIVE}`));
    await append(goalRecord("g1", null, { met: false, sentinel: true }));
    observe({ type: "result", subtype: "error_during_execution" });
    await wait.outcome;
    expect(readClaudeSessionGoal(session)).toEqual({ objective: OBJECTIVE, ended: false });
  });

  test("a clear settles at its reply and removes the goal", async () => {
    const { session, observe, events, append, settled } = await createSession([
      goalRecord("g1", null, { met: false, sentinel: true }),
    ]);
    await restoreClaudeSessionGoal(session, "2026-11-07T10:00:00.000Z");
    const wait = beginClaudeGoalCommand(session, { kind: "clear" });
    observe(goalReply("clear", `Goal cleared: ${OBJECTIVE}`));
    await wait.outcome;
    expect(events.at(-1)?.goal).toBeNull();
    // The clear record that OpenDucktor sent does not end a later goal.
    await append(goalRecord("g2", "g1", { met: true, sentinel: true }));
    observe(result);
    await settled();
    expect(readClaudeSessionGoal(session)).toBeNull();
  });

  test("a turn result reads a met goal as ended", async () => {
    const { session, observe, append, events, settled } = await createSession([
      goalRecord("g1", null, { met: false, sentinel: true }),
    ]);
    await restoreClaudeSessionGoal(session, "2026-11-07T10:00:00.000Z");
    await append(goalRecord("g2", "g1", { met: true }));
    observe(result);
    await settled();
    expect(events.at(-1)?.goal).toEqual({ objective: OBJECTIVE, ended: true });
    expect(forgetEndedClaudeGoal(session, "2026-11-07T10:00:01.000Z")?.goal).toBeNull();
  });

  test("a clear that OpenDucktor did not send ends the goal", async () => {
    const { session, observe, append, settled } = await createSession([
      goalRecord("g1", null, { met: false, sentinel: true }),
    ]);
    await restoreClaudeSessionGoal(session, "2026-11-07T10:00:00.000Z");
    await append(goalRecord("g2", "g1", { met: true, sentinel: true }));
    observe(result);
    await settled();
    expect(readClaudeSessionGoal(session)).toEqual({ objective: OBJECTIVE, ended: true });
  });

  test("a live read leaves a line that Claude still writes for the next read", async () => {
    const { session, observe, path, settled } = await createSession([
      goalRecord("g1", null, { met: false, sentinel: true }),
    ]);
    await restoreClaudeSessionGoal(session, "2026-11-07T10:00:00.000Z");
    const partial = JSON.stringify(goalRecord("g2", "g1", { met: true }));
    await appendFile(path, partial.slice(0, 20));
    observe(result);
    await settled();
    expect(readClaudeSessionGoal(session)).toEqual({ objective: OBJECTIVE, ended: false });
    await appendFile(path, `${partial.slice(20)}\n`);
    observe(result);
    await settled();
    expect(readClaudeSessionGoal(session)).toEqual({ objective: OBJECTIVE, ended: true });
  });

  test("refuses a second goal action while one runs", async () => {
    const { session } = await createSession();
    beginClaudeGoalCommand(session, { kind: "clear" });
    expect(() => beginClaudeGoalCommand(session, { kind: "clear" })).toThrow(
      "Another goal action is still running",
    );
  });
});

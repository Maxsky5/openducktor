import { describe, expect, test } from "bun:test";
import { AgentSessionMessageRefusedError } from "@openducktor/core";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";
import { prepareFixture } from "./opencode-v2-live.test-support";
import { noContent, ref, type NativeRequest } from "./opencode-v2.test-support";

const sessionInput = {
  ...ref,
  runtimePolicy: { kind: "opencode" as const },
  sessionScope: { kind: "repository" as const, workspaceId: "repo" },
};
const nativeGoal = {
  id: "goal-1",
  objective: "Ship the release",
  status: "paused",
  reason: "Stopped by the user",
  rounds: 2,
  maxRounds: 50,
  boot: "boot-1",
  updatedAt: 10,
};
const isGoalRead = ({ url }: NativeRequest) => url.pathname === "/api/rpc/opencode.goal/get";
const isGoalCommand = ({ url }: NativeRequest) =>
  url.pathname === `/api/session/${ref.externalSessionId}/command`;
const isInstructionWrite = ({ url, method }: NativeRequest) =>
  method === "PUT" && url.pathname.includes("/instructions/entries/");

const goalServer = (
  options: {
    version?: string;
    goal?: typeof nativeGoal | null;
    active?: boolean;
    command?: () => Response;
  } = {},
) =>
  prepareFixture((request) => {
    if (request.url.pathname === "/api/info")
      return Response.json({
        version: options.version ?? "2.2.5",
        pid: 42,
        urls: [],
        paths: { tmp: "/tmp" },
      });
    if (isGoalRead(request)) return Response.json({ output: options.goal ?? null });
    if (request.url.pathname === "/api/session/active")
      return Response.json({ data: options.active ? { [ref.externalSessionId]: true } : {} });
    if (isGoalCommand(request)) return options.command?.() ?? noContent();
    if (isInstructionWrite(request)) return noContent();
    return undefined;
  });

describe("OpenCode goals", () => {
  test("reads the goal of each restored session from the goal plugin", async () => {
    const fixture = goalServer({ goal: nativeGoal });
    const runtime = await fixture.prepare();
    try {
      const read = await runtime.connection.readSessionSources(ref.repoPath, [sessionInput]);
      expect(read.sources[0]?.goal).toEqual({
        objective: "Ship the release",
        status: "paused",
        reason: "Stopped by the user",
      });
      const goalRead = fixture.requests.find(isGoalRead);
      expect(goalRead?.url.searchParams.get("location[directory]")).toBe(ref.workingDirectory);
      expect(goalRead?.body).toEqual({ input: { sessionID: ref.externalSessionId } });
    } finally {
      await runtime.release();
    }
  });

  test("reports no goal field and sends no goal call to a server older than 2.2.1", async () => {
    const fixture = goalServer({ version: "2.1.9" });
    const runtime = await fixture.prepare();
    try {
      const read = await runtime.connection.readSessionSources(ref.repoPath, [sessionInput]);
      expect(read.sources[0]).not.toHaveProperty("goal");
      await runtime.connection.resumeSession(sessionInput);
      const result = await runtime.connection
        .controlGoal({ ...sessionInput, command: { kind: "pause" } })
        .catch((cause: unknown) => cause);
      expect(result).toBeInstanceOf(AgentSessionMessageRefusedError);
      expect(String(result)).toContain(
        "Goals need OpenCode 2.2.1 or later. Run `opencode upgrade`.",
      );
      expect(fixture.requests.some(isGoalRead)).toBe(false);
      expect(fixture.requests.some(isGoalCommand)).toBe(false);
    } finally {
      await runtime.release();
    }
  });

  test("forwards each goal change of an attached session, and a cleared goal as null", async () => {
    const fixture = goalServer();
    const runtime = await fixture.prepare();
    const goals: Extract<OpencodeSessionRuntimeSignal, { type: "goal_updated" }>[] = [];
    let cleared!: () => void;
    const done = new Promise<void>((resolve) => {
      cleared = resolve;
    });
    try {
      await runtime.connection.resumeSession(sessionInput);
      await runtime.startForwarding((signal) => {
        if (signal.type !== "goal_updated") return;
        goals.push(signal);
        if (signal.goal === null) cleared();
      });
      const location = { directory: ref.workingDirectory };
      fixture.channel.push({
        id: "goal_other",
        type: "rpc.opencode.goal.changed",
        created: 1,
        location,
        data: { sessionID: "ses_unattached", goal: { ...nativeGoal, status: "active" } },
      });
      fixture.channel.push({
        id: "goal_set",
        type: "rpc.opencode.goal.changed",
        created: 2,
        location,
        data: {
          sessionID: ref.externalSessionId,
          goal: { ...nativeGoal, status: "active", reason: undefined },
        },
      });
      fixture.channel.push({
        id: "goal_cleared",
        type: "rpc.opencode.goal.changed",
        created: 3,
        location,
        data: { sessionID: ref.externalSessionId, goal: null },
      });
      await done;
      expect(goals).toEqual([
        {
          type: "goal_updated",
          externalSessionId: ref.externalSessionId,
          goal: { objective: "Ship the release", status: "active" },
        },
        { type: "goal_updated", externalSessionId: ref.externalSessionId, goal: null },
      ]);
    } finally {
      await runtime.release();
    }
  });

  test("pauses and clears a goal while the agent works, without new-turn instructions", async () => {
    const fixture = goalServer({ active: true });
    const runtime = await fixture.prepare();
    try {
      await runtime.connection.resumeSession(sessionInput);
      let sent = 0;
      await runtime.connection.controlGoal(
        { ...sessionInput, command: { kind: "pause" } },
        { onSent: () => (sent += 1) },
      );
      await runtime.connection.controlGoal({ ...sessionInput, command: { kind: "clear" } });
      expect(sent).toBe(1);
      expect(fixture.requests.filter(isGoalCommand).map(({ body }) => body)).toEqual([
        { name: "goal", text: "pause", delivery: "steer" },
        { name: "goal", text: "clear", delivery: "steer" },
      ]);
      expect(fixture.requests.some(isInstructionWrite)).toBe(false);
    } finally {
      await runtime.release();
    }
  });

  test("writes the instructions before a new goal starts a turn, and reports running", async () => {
    const fixture = goalServer();
    const runtime = await fixture.prepare();
    const statuses: string[] = [];
    try {
      await runtime.connection.resumeSession(sessionInput);
      await runtime.startForwarding((signal) => {
        if (signal.type === "session_event" && signal.event.type === "session_status")
          statuses.push(signal.event.status.type);
      });
      await runtime.connection.controlGoal({
        ...sessionInput,
        systemPrompt: "Current instructions",
        command: { kind: "set", objective: "Ship the release" },
      });
      const writes = fixture.requests.flatMap((request, index) =>
        isInstructionWrite(request) ? [index] : [],
      );
      const command = fixture.requests.findIndex(isGoalCommand);
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every((index) => index < command)).toBe(true);
      expect(fixture.requests[command]?.body).toEqual({
        name: "goal",
        text: "Ship the release",
        delivery: "queue",
      });
      expect(statuses).toEqual(["busy"]);
    } finally {
      await runtime.release();
    }
  });

  test("fails with the reason of the goal plugin and settles the running report", async () => {
    const fixture = goalServer({
      command: () =>
        Response.json(
          { _tag: "CommandExecutionError", command: "goal", message: "No paused goal to resume." },
          { status: 500 },
        ),
    });
    const runtime = await fixture.prepare();
    const statuses: string[] = [];
    try {
      await runtime.connection.resumeSession(sessionInput);
      await runtime.startForwarding((signal) => {
        if (signal.type === "session_event" && signal.event.type === "session_status")
          statuses.push(signal.event.status.type);
      });
      const result = await runtime.connection
        .controlGoal({ ...sessionInput, command: { kind: "resume" } })
        .catch((cause: unknown) => cause);
      expect(result).toBeInstanceOf(Error);
      expect(String(result)).toContain("No paused goal to resume.");
      expect(statuses).toEqual(["busy", "idle"]);
    } finally {
      await runtime.release();
    }
  });
});

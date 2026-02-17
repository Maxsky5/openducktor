import { describe, expect, test } from "bun:test";
import type { RunEvent } from "@openblueprint/contracts";
import { OpencodeSdkAdapter } from "./index";

describe("OpencodeSdkAdapter", () => {
  test("planner session emits lifecycle and planner acknowledgement events", async () => {
    const adapter = new OpencodeSdkAdapter();
    const events: RunEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    await adapter.startPlanSession({
      sessionId: "session-1",
      repoPath: "/repo",
      taskId: "task-1",
    });
    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Draft a spec",
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("run_started");
    expect(events[1]?.type).toBe("agent_thought");
    if (events[1]?.type === "agent_thought") {
      expect(events[1].message).toContain("Planner acknowledged");
    }
  });

  test("builder session acknowledges with builder phrasing", async () => {
    const adapter = new OpencodeSdkAdapter();
    const events: RunEvent[] = [];
    adapter.subscribeEvents("session-2", (event) => {
      events.push(event);
    });

    await adapter.startBuildSession({
      sessionId: "session-2",
      repoPath: "/repo",
      taskId: "task-9",
    });
    await adapter.sendUserMessage({
      sessionId: "session-2",
      content: "Implement fix",
    });

    const thought = events.find((event) => event.type === "agent_thought");
    expect(thought?.type).toBe("agent_thought");
    if (thought?.type === "agent_thought") {
      expect(thought.message).toContain("Builder acknowledged");
    }
  });

  test("unsubscribe stops event delivery", async () => {
    const adapter = new OpencodeSdkAdapter();
    const events: RunEvent[] = [];
    const unsubscribe = adapter.subscribeEvents("session-3", (event) => {
      events.push(event);
    });

    unsubscribe();
    await adapter.startPlanSession({
      sessionId: "session-3",
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(events).toHaveLength(0);
  });

  test("sendUserMessage rejects unknown session", async () => {
    const adapter = new OpencodeSdkAdapter();
    await expect(
      adapter.sendUserMessage({
        sessionId: "unknown",
        content: "hello",
      }),
    ).rejects.toThrow("Unknown session");
  });

  test("stopSession emits run_finished and closes session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const events: RunEvent[] = [];
    adapter.subscribeEvents("session-4", (event) => {
      events.push(event);
    });

    await adapter.startBuildSession({
      sessionId: "session-4",
      repoPath: "/repo",
      taskId: "task-2",
    });
    await adapter.stopSession("session-4");

    const finished = events.find((event) => event.type === "run_finished");
    expect(finished?.type).toBe("run_finished");
    if (finished?.type === "run_finished") {
      expect(finished.success).toBe(true);
    }

    await expect(
      adapter.sendUserMessage({
        sessionId: "session-4",
        content: "still there?",
      }),
    ).rejects.toThrow("Unknown session");
  });
});

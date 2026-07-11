import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { CodexSubagentLifecycleProjector } from "./codex-subagent-lifecycle-projector";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexNotificationRecord, CodexSessionState } from "./types";

const createSession = (threadId: string, runtimeId = "runtime-1"): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    title: threadId,
    status: "running",
    role: "build",
    startedAt: "2026-07-10T12:00:00.000Z",
  },
  systemPrompt: "",
  role: "build",
  runtimeId,
  repoPath: "/repo",
  threadId,
  workingDirectory: "/repo",
  taskId: "task-1",
  model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
});

const childLifecycleNotification = (
  method: "turn/started" | "turn/completed",
  status: "inProgress" | "completed" | "failed",
  error?: string,
  timestampSeconds?: number,
): CodexNotificationRecord => ({
  method,
  receivedAt: "2026-07-10T12:00:04.000Z",
  params: {
    threadId: "child-thread",
    turn: {
      id: "child-turn",
      status,
      ...(method === "turn/started"
        ? { startedAt: timestampSeconds ?? 1_783_683_602 }
        : { completedAt: timestampSeconds ?? 1_783_683_604 }),
      ...(error ? { error: { message: error } } : {}),
    },
  },
});

const createHarness = () => {
  const parent = createSession("parent-thread");
  const sessions = new Map([[parent.threadId, parent]]);
  const subagents = new CodexSubagentLinkState();
  const events: AgentEvent[] = [];
  const projector = new CodexSubagentLifecycleProjector({
    sessions,
    subagents,
    emitParentSessionEvent: (_externalSessionId, event) => events.push(event),
  });
  return { events, parent, projector, sessions, subagents };
};

const linkChild = (subagents: CodexSubagentLinkState, runtimeId = "runtime-1") => {
  subagents.upsertLink({
    runtimeId,
    parentThreadId: "parent-thread",
    childThreadId: "child-thread",
    itemId: "spawn-1",
    status: "running",
  });
  const route = subagents.routeForChild("child-thread", runtimeId);
  if (!route) {
    throw new Error("Expected child route");
  }
  return route;
};

const emittedStatuses = (events: AgentEvent[]) =>
  events.flatMap((event) =>
    event.type === "assistant_part" && event.part.kind === "subagent" ? [event.part.status] : [],
  );

const emittedSubagentParts = (events: AgentEvent[]) =>
  events.flatMap((event) =>
    event.type === "assistant_part" && event.part.kind === "subagent" ? [event.part] : [],
  );

describe("CodexSubagentLifecycleProjector", () => {
  test("projects a completion buffered before the parent-child link", () => {
    const { events, projector, subagents } = createHarness();
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed"),
    );

    projector.projectBufferedRoute(linkChild(subagents));

    expect(emittedStatuses(events)).toEqual(["completed"]);
  });

  test("projects only the latest lifecycle update buffered before the link", () => {
    const { events, projector, subagents } = createHarness();
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed", undefined, 1_783_683_620),
    );
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/started", "inProgress", undefined, 1_783_683_630),
    );

    projector.projectBufferedRoute(linkChild(subagents));

    expect(emittedStatuses(events)).toEqual([]);
    expect(subagents.statusForChild("child-thread", "runtime-1")).toBe("running");
  });

  test("keeps a newer buffered restart when a stale completion arrives later", () => {
    const { events, projector, subagents } = createHarness();
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/started", "inProgress", undefined, 1_783_683_630),
    );
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed", undefined, 1_783_683_620),
    );

    projector.projectBufferedRoute(linkChild(subagents));

    expect(events).toEqual([]);
    expect(subagents.statusForChild("child-thread", "runtime-1")).toBe("running");
  });

  test("keeps buffered child lifecycle isolated by runtime", () => {
    const { events, parent, projector, sessions, subagents } = createHarness();
    sessions.set("parent-two", createSession("parent-two", "runtime-2"));
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed"),
    );
    subagents.upsertLink({
      runtimeId: "runtime-2",
      parentThreadId: "parent-two",
      childThreadId: "child-thread",
      itemId: "spawn-two",
      status: "running",
    });
    const runtimeTwoRoute = subagents.routeForChild("child-thread", "runtime-2");
    if (!runtimeTwoRoute) {
      throw new Error("Expected runtime-two route");
    }
    projector.projectBufferedRoute(runtimeTwoRoute);

    expect(events).toEqual([]);

    projector.projectBufferedRoute(linkChild(subagents));

    expect(emittedStatuses(events)).toEqual(["completed"]);
    expect(parent.runtimeId).toBe("runtime-1");
  });

  test("restarts a terminal child from an actual child turn start", () => {
    const { events, projector, subagents } = createHarness();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "error",
      error: "First child turn failed",
    });

    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/started", "inProgress"),
    );

    expect(emittedStatuses(events)).toEqual(["running"]);
    expect(subagents.statusForChild("child-thread", "runtime-1")).toBe("running");
  });

  test("ignores a previous turn completion delivered after a child restart", () => {
    const { events, projector, subagents } = createHarness();
    linkChild(subagents);

    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/started", "inProgress", undefined, 1_783_683_630),
    );
    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed", undefined, 1_783_683_620),
    );

    expect(events).toEqual([]);
    expect(subagents.statusForChild("child-thread", "runtime-1")).toBe("running");
  });

  test("projects completion timing after inventory already recorded completion", () => {
    const { events, projector, subagents } = createHarness();
    const route = linkChild(subagents);
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: route.parentExternalSessionId,
      childThreadId: route.childExternalSessionId,
      itemId: route.childExternalSessionId,
      status: "completed",
    });

    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed"),
    );

    expect(emittedSubagentParts(events)).toEqual([
      expect.objectContaining({
        status: "completed",
        endedAtMs: 1_783_683_604_000,
      }),
    ]);
  });

  test("projects failure detail after the link already recorded an error", () => {
    const { events, projector, subagents } = createHarness();
    const route = linkChild(subagents);
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: route.parentExternalSessionId,
      childThreadId: route.childExternalSessionId,
      itemId: route.childExternalSessionId,
      status: "error",
    });

    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "failed", "Child command failed"),
    );

    expect(emittedSubagentParts(events)).toEqual([
      expect.objectContaining({
        status: "error",
        error: "Child command failed",
        endedAtMs: 1_783_683_604_000,
      }),
    ]);
  });

  test("does not project a stale lower-precedence terminal update", () => {
    const { events, projector, subagents } = createHarness();
    const route = linkChild(subagents);
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: route.parentExternalSessionId,
      childThreadId: route.childExternalSessionId,
      itemId: route.childExternalSessionId,
      status: "error",
      error: "Authoritative failure",
    });

    projector.projectNotification(
      "runtime-1",
      childLifecycleNotification("turn/completed", "completed"),
    );

    expect(events).toEqual([]);
  });
});

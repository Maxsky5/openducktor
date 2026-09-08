import { describe, expect, test } from "bun:test";
import { resolveCodexRetainedSessionOwner } from "./codex-retained-session-owner";
import type { CodexSubagentRoute } from "./codex-subagent-link-state";
import type { CodexSessionState } from "./types";

const session = (threadId: string, runtimeId = "runtime-1"): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    title: threadId,
    status: "running",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    runtimeKind: "codex",
    startedAt: "2026-06-13T00:00:00.000Z",
  },
  systemPrompt: "",
  role: "build",
  runtimeId,
  repoPath: "/repo",
  threadId,
  workingDirectory: "/repo",
  taskId: "task-1",
});

const route = (child: string, parent: string, runtimeId = "runtime-1"): CodexSubagentRoute => ({
  runtimeId,
  childExternalSessionId: child,
  parentExternalSessionId: parent,
  subagentCorrelationKey: `${parent}:${child}`,
});

const resolve = (threadId: string, sessions: CodexSessionState[], routes: CodexSubagentRoute[]) =>
  resolveCodexRetainedSessionOwner({
    threadId,
    runtimeId: "runtime-1",
    sessions: new Map(sessions.map((value) => [value.threadId, value])),
    subagents: {
      routeForChild: (child) =>
        routes.find((value) => value.childExternalSessionId === child) ?? null,
    },
  });

describe("resolveCodexRetainedSessionOwner", () => {
  test("keeps a directly retained child as its own owner", () => {
    const root = session("root");
    const child = session("child");
    expect(resolve("child", [root, child], [route("child", "root")])).toEqual({
      retainedSession: child,
      route: null,
    });
  });

  test("returns the target route and nearest retained ancestor for a nested child", () => {
    const root = session("root");
    const child = session("child");
    const targetRoute = route("grandchild", "child");
    const routes = [targetRoute, route("child", "root")];
    expect(resolve("grandchild", [root, child], routes)).toEqual({
      retainedSession: child,
      route: targetRoute,
    });
    expect(resolve("grandchild", [root], routes)).toEqual({
      retainedSession: root,
      route: targetRoute,
    });
  });

  test("accepts unscoped routes only when the retained owner belongs to the requested runtime", () => {
    const root = session("root");
    const unscoped: CodexSubagentRoute = {
      childExternalSessionId: "child",
      parentExternalSessionId: "root",
      subagentCorrelationKey: "root:child",
    };
    expect(resolve("child", [root], [unscoped])).toEqual({
      retainedSession: root,
      route: unscoped,
    });
    expect(resolve("child", [session("root", "runtime-2")], [unscoped])).toBeUndefined();
  });

  test("does not walk past a retained session from another runtime", () => {
    expect(
      resolve("child", [session("root"), session("child", "runtime-2")], [route("child", "root")]),
    ).toBeUndefined();
    expect(
      resolve(
        "grandchild",
        [session("root"), session("child", "runtime-2")],
        [route("grandchild", "child"), route("child", "root")],
      ),
    ).toBeUndefined();
  });

  test.each([
    [route("child", "root", "runtime-2")],
    [route("child", "middle"), route("middle", "root", "runtime-2")],
  ])("rejects a route from another runtime at any depth", (...routes) => {
    expect(resolve("child", [session("root")], routes)).toBeUndefined();
  });

  test("returns no owner for missing routes, missing ancestors, and cycles", () => {
    expect(resolve("missing", [session("root")], [])).toBeUndefined();
    expect(resolve("child", [], [route("child", "root")])).toBeUndefined();
    expect(
      resolve("child", [], [route("child", "middle"), route("middle", "child")]),
    ).toBeUndefined();
  });
});

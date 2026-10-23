import { describe, expect, test } from "bun:test";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import { createWorkspaceRecordFixture } from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  keptSessionViewAddress,
  resolveSessionViews,
  type SessionView,
  type SessionViewsInput,
  type SessionViewsState,
} from "./session-view-resolution";
import type { SessionViewScope } from "./session-view-scope";

const alpha = createWorkspaceRecordFixture({ workspaceId: "alpha" });
const beta = createWorkspaceRecordFixture({ workspaceId: "beta", repoPath: "/beta" });
const scope: SessionViewScope = [(children) => children];
const bareTaskSearch = "?workspace=alpha&kind=task";
const plannerSearch = "?workspace=alpha&kind=task&task=current&session=native&agent=planner";
const plannerTarget: SessionNavigationTarget = {
  kind: "task_session",
  workspaceId: "alpha",
  taskId: "current",
  role: "planner",
  identity: { externalSessionId: "native", runtimeKind: "opencode", workingDirectory: "/repo" },
};

const taskView = (id: string, search: string): SessionView => ({
  id,
  search,
  state: null,
  kind: "task",
  workspace: alpha,
  scope,
});

const input = (overrides: Partial<SessionViewsInput>): SessionViewsInput => {
  let nextId = 0;
  return {
    workspace: alpha,
    kind: "task",
    isReady: true,
    location: { search: plannerSearch, state: null },
    published: null,
    scope,
    isOpen: () => true,
    hasOwner: () => true,
    createId: () => `new-${++nextId}`,
    ...overrides,
  };
};

type SessionlessState = {
  sessionlessTask: { workspaceId: string; taskId: string; role: string };
};

const at = (search: string, state: SessionlessState | null = null) => ({
  location: { search, state },
});

const shown = (state: SessionViewsState) =>
  state.views.map((view) => [view.id, view.search, view.id === state.activeId]);

/** `SessionViews` stores the result during render, so the result must resolve to itself. */
const settle = (state: SessionViewsState, value: SessionViewsInput): SessionViewsState => {
  const next = resolveSessionViews(state, value);
  expect(resolveSessionViews(next, value)).toBe(next);
  return next;
};

describe("resolveSessionViews", () => {
  test("new content that restores a kept selection leaves it to the kept view", () => {
    const kept = taskView("kept", plannerSearch);
    const restored = taskView("restored", bareTaskSearch);
    const published = { viewId: "restored", target: plannerTarget };
    const restoring = settle(
      { views: [kept, restored], activeId: "restored" },
      input({ ...at(bareTaskSearch), published }),
    );

    expect(shown(restoring)).toEqual([
      ["kept", plannerSearch, false],
      ["restored", bareTaskSearch, true],
    ]);

    const written = settle(restoring, input({ ...at(plannerSearch), published }));

    expect(written.views).toEqual([kept]);
    expect(written.activeId).toBe("kept");
  });

  test("the active view keeps the session that its content resolves before the address names it", () => {
    const value = input(at(bareTaskSearch));
    const opened = settle({ views: [], activeId: null }, value);
    const viewId = opened.activeId;
    if (viewId === null) throw new Error("Expected an active view.");

    const resolved = settle(opened, { ...value, published: { viewId, target: plannerTarget } });

    expect(shown(resolved)).toEqual([[viewId, plannerSearch, true]]);
  });

  test("a new session composer for a shorter address replaces the session of the active view", () => {
    const composer = {
      sessionlessTask: { workspaceId: "alpha", taskId: "current", role: "build" },
    };
    const buildSearch = "?workspace=alpha&kind=task&task=current&agent=build";
    const state = settle(
      { views: [taskView("view", `${buildSearch}&session=first`)], activeId: "view" },
      input({
        ...at(buildSearch, composer),
        published: {
          viewId: "view",
          target: { kind: "task", workspaceId: "alpha", taskId: "current", role: "build" },
        },
      }),
    );

    expect(shown(state)).toEqual([["view", buildSearch, true]]);
    expect(keptSessionViewAddress(state.views, "alpha", "task")).toEqual({
      search: buildSearch,
      state: composer,
    });
  });

  test("the active view follows the session that its content shows for a shorter address", () => {
    const latestSearch = "?workspace=alpha&kind=task&task=current&session=latest&agent=planner";
    const state = settle(
      { views: [taskView("view", plannerSearch)], activeId: "view" },
      input({
        ...at("?workspace=alpha&kind=task&task=current&agent=planner"),
        published: {
          viewId: "view",
          target: {
            ...plannerTarget,
            identity: { ...plannerTarget.identity, externalSessionId: "latest" },
          },
        },
      }),
    );

    expect(shown(state)).toEqual([["view", latestSearch, true]]);
  });

  test("a view that clears its chat shows the next chat of its content", () => {
    const chat = (sessionId: string) => `?workspace=alpha&kind=workspace&session=${sessionId}`;
    const chatView: SessionView = {
      id: "chat",
      search: chat("archived"),
      state: null,
      kind: "workspace",
      workspace: alpha,
      scope,
    };
    const value = input({ kind: "workspace", ...at("?workspace=alpha&kind=workspace") });
    const cleared = settle(
      { views: [chatView], activeId: "chat" },
      { ...value, scope: [(children) => children] },
    );
    const published = {
      viewId: "chat",
      target: { kind: "workspace_session", workspaceId: "alpha", sessionId: "next" } as const,
    };
    const created = settle(settle(cleared, { ...value, published }), {
      ...value,
      ...at(chat("next")),
      published,
    });

    expect(shown(created)).toEqual([["chat", chat("next"), true]]);
  });

  test("a workspace keeps the address and history state of its last view", () => {
    const sessionless = {
      sessionlessTask: { workspaceId: "alpha", taskId: "next", role: "build" },
    };
    const nextSearch = "?workspace=alpha&kind=task&task=next&agent=build";
    let nextId = 0;
    const visit = (overrides: Partial<SessionViewsInput>) =>
      input({ createId: () => `view-${++nextId}`, ...overrides });
    let state = settle({ views: [], activeId: null }, visit({}));
    state = settle(
      state,
      visit(at(`${nextSearch}&attention=permission&attentionId=a-1`, sessionless)),
    );
    state = settle(
      state,
      visit({
        workspace: beta,
        ...at("?workspace=beta&kind=task&task=other&session=native&agent=planner"),
      }),
    );

    expect(keptSessionViewAddress(state.views, "alpha", "task")).toEqual({
      search: nextSearch,
      state: sessionless,
    });
    expect(keptSessionViewAddress(state.views, "alpha", "workspace")).toBeNull();
  });

  test("every result stays the same and no two kept views share a selection", () => {
    const random = seededRandom(1);
    const pick = <T>(values: readonly T[]): T => {
      const value = values[Math.floor(random() * values.length)];
      if (value === undefined) throw new Error("Expected a value to pick.");
      return value;
    };
    const scopes: SessionViewScope[] = [scope, [(children) => children]];
    const states = [null, { sessionlessTask: { workspaceId: "alpha", taskId: "current" } }];
    const hasOwner = (view: SessionView) => !view.search.includes("session=gone");
    for (let run = 0; run < 200; run += 1) {
      let state: SessionViewsState = { views: [], activeId: null };
      let nextId = 0;
      const createId = () => `view-${++nextId}`;
      const closed = new Set<string>();
      for (let step = 0; step < 40; step += 1) {
        if (random() < 0.05) closed.add("beta");
        if (random() < 0.1) closed.clear();
        const workspace = pick([alpha, beta]);
        const kind = random() < 0.1 ? null : pick(["task", "workspace"] as const);
        const viewId = state.views.length === 0 || random() < 0.2 ? null : pick(state.views).id;
        const kept =
          kind !== null && random() < 0.3
            ? keptSessionViewAddress(state.views, workspace.workspaceId, kind)
            : null;
        const value: SessionViewsInput = {
          workspace: random() < 0.05 ? null : workspace,
          kind,
          isReady: random() < 0.9,
          location: kept ?? {
            search: pick(addresses(workspace, kind ?? pick(["task", "workspace"] as const))),
            state: pick(states),
          },
          published: random() < 0.3 ? null : { viewId, target: pick(targets) },
          scope: pick(scopes),
          isOpen: (candidate) => !closed.has(candidate.workspaceId),
          hasOwner,
          createId,
        };
        state = settle(state, value);
        const selections = state.views.filter(hasOwner).map((view) => {
          const params = new URLSearchParams(view.search);
          return [
            view.workspace.workspaceId,
            view.kind,
            params.get("task"),
            params.get("session"),
            params.get("agent"),
          ].join();
        });
        expect(new Set(selections).size).toBe(selections.length);
      }
    }
  });
});

const addresses = (workspace: ActiveWorkspace, kind: "task" | "workspace"): string[] => {
  const base = `?workspace=${workspace.workspaceId}&kind=${kind}`;
  return kind === "task"
    ? [
        base,
        `${base}&task=current`,
        `${base}&task=current&agent=planner`,
        `${base}&task=current&session=native&agent=planner`,
        `${base}&task=current&session=other&agent=build`,
        `${base}&task=next&session=gone&agent=planner`,
        `${base}&session=native`,
      ]
    : [
        base,
        `${base}&create=session`,
        `${base}&session=chat`,
        `${base}&session=gone`,
        `${base}&task=current`,
      ];
};

const targets: SessionNavigationTarget[] = ["alpha", "beta"].flatMap((workspaceId) => [
  { ...plannerTarget, workspaceId },
  {
    ...plannerTarget,
    workspaceId,
    role: "build",
    identity: { ...plannerTarget.identity, externalSessionId: "other" },
  },
  { kind: "task", workspaceId, taskId: "current", role: null },
  { kind: "task", workspaceId, taskId: "next", role: "planner" },
  { kind: "workspace_session", workspaceId, sessionId: "chat" },
  { kind: "workspace_session", workspaceId, sessionId: "gone" },
]);

/** A small seeded generator, so a failure repeats with the same steps. */
function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

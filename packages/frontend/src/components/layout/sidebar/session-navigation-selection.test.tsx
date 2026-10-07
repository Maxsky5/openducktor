import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { sessionNavigationTargetKey } from "@/features/session-navigation/session-navigation-target";
import { selectSessionEntry } from "./session-navigation-selection";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionNavigationRail } from "./session-navigation-rail";
import { SessionNavigationTestProvider } from "./session-navigation-test-provider";
import {
  betaWorkspace,
  NOW,
  navigationModel,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

describe("session selection", () => {
  test.each([
    ["expanded", SessionNavigationList],
    ["collapsed", SessionNavigationRail],
  ] as const)(
    "keeps the %s task card clickable when another session is open",
    (_mode, Component) => {
      const entry = taskSessionEntry("builder");
      if (entry.target.kind !== "task_session") throw new Error("Expected a task session.");
      const visible = {
        ...entry.target,
        identity: { ...entry.target.identity, externalSessionId: "qa-session" },
      };
      const model = navigationModel({ recent: [entry] });
      const selection = selectSessionEntry(model, visible, "task");
      const onOpen = mock((_entry: SessionNavigationEntry) => {});
      render(
        <SessionNavigationTestProvider>
          <Component
            model={model}
            selection={selection}
            now={NOW}
            onOpen={onOpen}
            onRetry={() => {}}
          />
        </SessionNavigationTestProvider>,
      );
      const row = screen.getByRole("button", { name: /Task builder/ });
      expect(row.getAttribute("aria-current")).toBe("true");
      fireEvent.click(row);
      expect(onOpen).toHaveBeenCalledWith(entry);
    },
  );

  test.each(["running", "recent"] as const)(
    "selects the task's %s card when another role session is open",
    (group) => {
      const entry = taskSessionEntry("builder");
      if (entry.target.kind !== "task_session") throw new Error("Expected a task session.");
      const visible = {
        ...entry.target,
        role: "qa" as const,
        identity: {
          ...entry.target.identity,
          externalSessionId: "qa-session",
          runtimeKind: "claude" as const,
        },
      };
      const model = navigationModel({ [group]: [entry] });
      expect(selectSessionEntry(model, visible, "task")).toEqual({
        visibleKey: sessionNavigationTargetKey(visible),
        entryKey: entry.key,
      });
      expect(selectSessionEntry(model, visible, "none").entryKey).toBe(
        sessionNavigationTargetKey(visible),
      );
    },
  );

  test("selects an exact input request before the other card for the same task", () => {
    const working = taskSessionEntry("builder", { taskId: "task-1", status: { kind: "running" } });
    const asking = taskSessionEntry("asking", {
      taskId: "task-1",
      role: "qa",
      attention: ["question"],
    });
    const model = navigationModel({ needs_you: [asking], running: [working] });
    expect(selectSessionEntry(model, asking.target, "task").entryKey).toBe(asking.key);
    if (working.target.kind !== "task_session") throw new Error("Expected a task session.");
    const hidden = {
      ...working.target,
      identity: { ...working.target.identity, externalSessionId: "hidden" },
    };
    expect(selectSessionEntry(model, hidden, "task").entryKey).toBe(working.key);
    expect(
      selectSessionEntry(navigationModel({ needs_you: [asking] }), hidden, "task").entryKey,
    ).toBe(asking.key);
  });

  test("does not select a matching task ID in another workspace or a workspace chat", () => {
    const entry = taskSessionEntry("builder");
    const otherWorkspace = taskSessionEntry("builder", { workspace: betaWorkspace });
    const chat = workspaceSessionEntry("chat");
    expect(
      selectSessionEntry(navigationModel({ recent: [otherWorkspace, chat] }), entry.target, "task")
        .entryKey,
    ).toBe(entry.key);
    expect(
      selectSessionEntry(navigationModel({ recent: [entry, chat] }), chat.target, "task").entryKey,
    ).toBe(chat.key);
    expect(selectSessionEntry(navigationModel({ recent: [entry] }), null, "task")).toEqual({
      visibleKey: null,
      entryKey: null,
    });
  });
});

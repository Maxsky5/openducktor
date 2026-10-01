import { SessionNavigationTestProvider } from "./session-navigation-test-provider";
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { SessionNavigationRail } from "./session-navigation-rail";
import {
  betaWorkspace,
  blockedTaskEntry,
  NOW,
  navigationModel,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

const renderRail = (
  model: ReturnType<typeof navigationModel>,
  selectedKey: string | null = null,
  onOpen: (entry: SessionNavigationEntry) => void = () => {},
  onRetry: (issue: ReturnType<typeof navigationModel>["issues"][number]) => void = () => {},
) =>
  render(
    <SessionNavigationTestProvider>
      <SessionNavigationRail
        onRetry={onRetry}
        model={model}
        selection={{ entryKey: selectedKey, visibleKey: selectedKey }}
        now={NOW}
        onOpen={onOpen}
      />
    </SessionNavigationTestProvider>,
  );

describe("SessionNavigationRail", () => {
  test("keeps the three groups with counts and one icon per session", () => {
    renderRail(
      navigationModel({
        needs_you: [
          taskSessionEntry("asking", { attention: ["question"] }),
          blockedTaskEntry("ci"),
        ],
        running: [workspaceSessionEntry("busy", { status: { kind: "running" } })],
        recent: [taskSessionEntry("done", { role: "spec" })],
      }),
    );

    const groups = screen.getAllByRole("region");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Needs you",
      "Running",
      "Recent",
    ]);
    expect(groups[0]!.textContent).toContain("Needs you2");
    expect(within(groups[0]!).getAllByRole("button")).toHaveLength(2);
    expect(within(groups[1]!).getAllByRole("button")).toHaveLength(1);
  });

  test("uses role, chat, and task icons instead of workspace avatars", () => {
    renderRail(
      navigationModel({
        needs_you: [blockedTaskEntry("ci")],
        recent: [
          taskSessionEntry("builder"),
          taskSessionEntry("spec", { role: "spec" }),
          workspaceSessionEntry("chat"),
        ],
      }),
    );

    const icons = screen
      .getAllByRole("button")
      .map((button) => button.querySelector("svg")?.getAttribute("class") ?? "");
    expect(icons[0]).toContain("lucide-clipboard-list");
    expect(icons[1]).toContain("lucide-role-builder");
    expect(icons[2]).toContain("lucide-role-spec");
    expect(icons[3]).toContain("lucide-messages-square");
    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent).not.toContain("OP");
    }
  });

  test("keeps the attention surface and a seen cue on the selected icon", () => {
    const selected = taskSessionEntry("visible", { attention: ["permission"] });
    const other = taskSessionEntry("other", { attention: ["question"] });
    renderRail(navigationModel({ needs_you: [selected, other] }), selected.key);

    const icon = screen.getByRole("button", { name: /Task visible/ });
    expect(icon.getAttribute("aria-current")).toBe("true");
    expect(icon.className).toContain("bg-warning-surface-selected");
    expect(within(icon).getByRole("img", { name: "Session read" })).toBeTruthy();
    expect(icon.querySelector(".lucide-check")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /Task other/ }).querySelector(".lucide-check"),
    ).toBeNull();
  });

  test("opens a floating card with title, task workflow, and activity time on focus", async () => {
    renderRail(
      navigationModel({
        needs_you: [
          taskSessionEntry("asking", {
            title: "Import tasks from git provider",
            workspace: betaWorkspace,
            attention: ["question"],
          }),
        ],
      }),
    );

    fireEvent.focus(screen.getByRole("button", { name: /Import tasks from git provider/ }));

    const card = await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="popover-content"]');
      if (!tooltip) throw new Error("The floating card is not open.");
      return tooltip;
    });
    expect(card.textContent).toContain("Import tasks from git provider");
    expect(card.textContent).toContain("Builder");
    expect(card.textContent).toContain("Active 6m ago");
  });

  test("opens a session when its icon is selected", () => {
    const onOpen = mock((_entry: SessionNavigationEntry) => {});
    const entry = workspaceSessionEntry("chat");
    renderRail(navigationModel({ recent: [entry] }), null, onOpen);

    fireEvent.click(screen.getByRole("button", { name: /Chat chat/ }));

    expect(onOpen).toHaveBeenCalledWith(entry);
  });
  test("shows source failures and permits retry while collapsed", async () => {
    const issue = {
      workspace: betaWorkspace,
      source: "workspace_sessions" as const,
      message: "Workspace is closed.",
    };
    const onRetry = mock(() => {});
    renderRail(
      navigationModel({ recent: [workspaceSessionEntry("kept")] }, { issues: [issue] }),
      null,
      () => {},
      onRetry,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Session list is incomplete. Show problems" }),
    );
    const problems = await screen.findByRole("list", { name: "Session list problems" });
    expect(problems.textContent).toContain("Workspace is closed.");
    fireEvent.click(within(problems).getByRole("button", { name: "Retry fairnest" }));
    expect(onRetry).toHaveBeenCalledWith(issue);
  });
});

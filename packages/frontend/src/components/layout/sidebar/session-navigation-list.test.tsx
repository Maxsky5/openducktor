import { SessionNavigationTestProvider } from "./session-navigation-test-provider";
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { SessionNavigationList } from "./session-navigation-list";
import {
  alphaWorkspace,
  betaWorkspace,
  blockedTaskEntry,
  NOW,
  navigationModel,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

const renderList = (
  model: ReturnType<typeof navigationModel>,
  {
    selectedKey = null,
    onOpen = () => {},
    onRetry = () => {},
  }: {
    selectedKey?: string | null;
    onOpen?: (entry: SessionNavigationEntry) => void;
    onRetry?: Parameters<typeof SessionNavigationList>[0]["onRetry"];
  } = {},
) =>
  render(
    <SessionNavigationTestProvider>
      <SessionNavigationList
        model={model}
        selection={{ entryKey: selectedKey, visibleKey: selectedKey }}
        now={NOW}
        onOpen={onOpen}
        onRetry={onRetry}
      />
    </SessionNavigationTestProvider>,
  );

describe("SessionNavigationList", () => {
  test("shows Needs you, Running, and Recent in order with accurate counts", () => {
    renderList(
      navigationModel({
        needs_you: [taskSessionEntry("asking", { attention: ["question"] })],
        recent: [workspaceSessionEntry("idle"), taskSessionEntry("done")],
      }),
    );

    const sections = screen.getAllByRole("region");
    expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual([
      "Needs you",
      "Running",
      "Recent",
    ]);
    expect(within(sections[1]!).getByLabelText("0 sessions").textContent).toBe("0");
    expect(within(sections[2]!).getByLabelText("2 sessions").textContent).toBe("2");
  });

  test("shows workspace names above titles with role icons, saved runtimes, and attention reasons", () => {
    renderList(
      navigationModel({
        needs_you: [
          taskSessionEntry("asking", {
            role: "qa",
            runtimeKind: "opencode",
            attention: ["permission", "blocked"],
          }),
          workspaceSessionEntry("chat", {
            runtimeKind: "claude",
            attention: ["question"],
            workspace: betaWorkspace,
          }),
          blockedTaskEntry("ci"),
        ],
        recent: [
          taskSessionEntry("plan", { role: "planner" }),
          taskSessionEntry("spec", { role: "spec" }),
          taskSessionEntry("build"),
        ],
      }),
    );

    const task = screen.getByRole("button", { name: /Task asking/ });
    expect(within(task).getByText("openducktor")).toBeTruthy();
    expect(task.textContent).toContain("Permission");
    expect(task.textContent).toContain("Blocked");
    expect(task.querySelector(".lucide-role-qa")).not.toBeNull();
    expect(within(task).getByRole("img", { name: "OpenCode runtime" })).toBeTruthy();
    expect(task.getAttribute("aria-label")).toContain("QA Task session");
    expect(task.getAttribute("aria-label")).toContain("Needs you: Permission, Blocked");
    const chat = screen.getByRole("button", { name: /Chat chat/ });
    expect(chat.textContent).toContain("fairnest");
    expect(chat.querySelector(".lucide-messages-square")).not.toBeNull();
    expect(within(chat).getByRole("img", { name: "Claude runtime" })).toBeTruthy();
    expect(chat.getAttribute("aria-label")).toContain(betaWorkspace.workspaceName);
    const blocked = screen.getByRole("button", { name: /Blocked ci/ });
    expect(blocked.textContent).toContain("openducktor");
    expect(blocked.querySelector(".lucide-clipboard-list")).not.toBeNull();
    expect(within(blocked).queryByRole("img", { name: / runtime$/ })).toBeNull();
    for (const [title, role, icon] of [
      ["Task plan", "Planner", ".lucide-role-planner"],
      ["Task spec", "Spec", ".lucide-role-spec"],
      ["Task build", "Builder", ".lucide-role-builder"],
    ] as const) {
      const row = screen.getByRole("button", { name: new RegExp(title) });
      expect(within(row).getByText("Backlog")).toBeTruthy();
      expect(within(row).getByText("6m")).toBeTruthy();
      expect(within(row).getByText(title)).toBeTruthy();
      expect(row.getAttribute("aria-label")).toContain(`${role} Task session`);
      expect(row.querySelector(icon)).not.toBeNull();
      expect(within(row).getByRole("img", { name: "Codex runtime" })).toBeTruthy();
    }
    for (const row of [task, chat, blocked]) {
      expect(row.textContent).not.toContain("Task session");
      expect(row.textContent).not.toContain("Workspace session");
      expect(row.textContent).not.toContain("OP");
      expect(row.textContent).not.toContain("FA");
    }
  });

  test("gives running rows the running cue without activity labels", () => {
    renderList(
      navigationModel({ running: [taskSessionEntry("busy", { status: { kind: "running" } })] }),
    );

    const row = screen.getByRole("button", { name: /Task busy/ });
    expect(row.getAttribute("aria-label")).toContain("Running");
    expect(row.className).toContain("bg-info-surface");
    for (const label of ["Working", "Researching", "Starting", "Running", "Viewing"]) {
      expect(row.textContent).not.toContain(label);
    }
  });

  test("gives an attention entry the warning cue instead of the running style", () => {
    const entry = taskSessionEntry("asking", {
      role: "qa",
      attention: ["blocked"],
      status: { kind: "running" },
    });
    renderList(navigationModel({ needs_you: [entry] }), { selectedKey: entry.key });

    const row = screen.getByRole("button", { name: /Task asking/ });
    expect(row.className).not.toContain("bg-info-surface");
    expect(row.querySelector(".bg-info-accent")).toBeNull();
    expect(row.className).toContain("bg-warning-surface-selected");
    expect(row.querySelector(".lucide-check")).not.toBeNull();
    expect(within(row).getByText("Blocked")).toBeTruthy();
  });

  test.each([
    { requests: [] },
    { requests: ["question"] },
    { requests: ["permission", "question"] },
  ] as const)(
    "shows one compact blocked status while keeping other attention reasons: %j",
    ({ requests }) => {
      const entry = taskSessionEntry("blocked", { attention: ["blocked", ...requests] });
      if (entry.context.kind !== "task") throw new Error("Expected a task session.");
      entry.context.task.status = "blocked";
      renderList(navigationModel({ needs_you: [entry] }));

      const row = screen.getByRole("button", { name: /Task blocked/ });
      expect(within(row).getAllByText("Blocked")).toHaveLength(1);
      expect(within(row).queryByText("Blocked needs input") === null).toBe(true);
      expect(within(row).queryByText("Question") !== null).toBe(
        requests.some((reason) => reason === "question"),
      );
      expect(within(row).queryByText("Permission") !== null).toBe(
        requests.some((reason) => reason === "permission"),
      );
    },
  );

  test("shows elapsed activity time and explains a start-only time in its details card", async () => {
    renderList(
      navigationModel({
        recent: [
          workspaceSessionEntry("chat"),
          taskSessionEntry("started", {
            time: { kind: "started", at: NOW - 2 * 3_600_000 },
          }),
        ],
      }),
    );

    expect(screen.getByRole("button", { name: /Chat chat/ }).textContent).toContain("28m");
    const started = screen.getByRole("button", { name: /Task started/ });
    expect(started.textContent).toContain("2h");
    fireEvent.focus(started);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="popover-content"]')?.textContent).toContain(
        "Started 2h ago",
      ),
    );
  });

  test("marks only the visible session selected and keeps its running style", () => {
    const selected = taskSessionEntry("visible", { status: { kind: "running" } });
    const onOpen = mock((_entry: SessionNavigationEntry) => {});
    renderList(
      navigationModel({
        running: [selected, taskSessionEntry("other", { status: { kind: "running" } })],
      }),
      {
        selectedKey: selected.key,
        onOpen,
      },
    );

    const row = screen.getByRole("button", { name: /Task visible/ });
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.className).toContain("bg-info-surface-selected");
    expect(row.querySelector(".lucide-check")).not.toBeNull();
    expect(row.querySelector(".bg-info-accent")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Task other/ }).getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Task other/ }).querySelector(".lucide-check"),
    ).toBeNull();

    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(selected);
    fireEvent.click(screen.getByRole("button", { name: /Task other/ }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  test("shows task details and observation faults on focus without a native browser tooltip", async () => {
    const entry = taskSessionEntry("asking", {
      title: "For testing, ask me any question about the sign in flow",
      workspace: betaWorkspace,
      role: "qa",
      attention: ["question", "permission"],
      fault: "Session status is unavailable.",
    });
    renderList(navigationModel({ needs_you: [entry] }));
    const row = screen.getByRole("button", { name: /For testing, ask me/ });
    expect(row.hasAttribute("title")).toBe(false);
    expect(row.querySelector("[title]")).toBeNull();
    fireEvent.focus(row);

    const card = await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="popover-content"]');
      if (!tooltip) throw new Error("The session details card is not open.");
      return tooltip;
    });
    expect(card.textContent).toContain(entry.title);
    expect(card.textContent).toContain("QA");
    expect(card.textContent).toContain("Session status is unavailable.");
  });

  test("keeps failures and lost status visible in Recent", () => {
    renderList(
      navigationModel({
        recent: [
          taskSessionEntry("failed", { status: { kind: "settled", failed: true } }),
          workspaceSessionEntry("lost", {
            status: { kind: "unavailable", reason: "Stream closed." },
          }),
        ],
      }),
    );

    expect(
      screen.getByRole("button", { name: /Task failed/ }).getAttribute("aria-label"),
    ).toContain("Last run failed");
    expect(screen.getByRole("button", { name: /Chat lost/ }).getAttribute("aria-label")).toContain(
      "Status unavailable: Stream closed.",
    );
  });

  test("names failed sources and retries all but live status", () => {
    const onRetry = mock(() => {});
    renderList(
      navigationModel(
        { recent: [workspaceSessionEntry("kept")] },
        {
          issues: [
            { workspace: betaWorkspace, source: "tasks", message: "Task store is locked." },
            { workspace: alphaWorkspace, source: "live_status", message: "Stream closed." },
          ],
        },
      ),
      { onRetry },
    );

    const problems = screen.getByRole("list", { name: "Session list problems" });
    expect(problems.textContent).toContain("fairnest: Tasks could not load. Task store is locked.");
    expect(problems.textContent).toContain(
      "openducktor: Live status is unavailable. Stream closed.",
    );
    expect(within(problems).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(problems).getByRole("button", { name: "Retry fairnest" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Chat kept/ })).toBeTruthy();
  });

  test("tells loading apart from an empty list", () => {
    const view = renderList(navigationModel({}, { isLoading: true }));
    expect(screen.getByRole("status").textContent).toBe("Loading sessions…");

    view.rerender(
      <SessionNavigationList
        model={navigationModel({})}
        selection={{ entryKey: null, visibleKey: null }}
        now={NOW}
        onOpen={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("No sessions yet. Start with New task or New chat.")).toBeTruthy();
  });

  test("a failed source keeps the list incomplete instead of claiming there are no sessions", () => {
    renderList(
      navigationModel(
        {},
        {
          issues: [
            {
              workspace: betaWorkspace,
              source: "workspace_sessions",
              message: "Workspace is closed.",
            },
          ],
        },
      ),
    );

    expect(screen.queryByText("No sessions yet. Start with New task or New chat.")).toBeNull();
    expect(screen.getByText("Session list is incomplete.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Workspace is closed.");
  });

  test("collapses a group without changing its count", () => {
    renderList(navigationModel({ recent: [workspaceSessionEntry("chat")] }));
    const toggle = screen.getByRole("button", { name: /Recent/ });

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Chat chat/ })).toBeNull();
    expect(toggle.textContent).toContain("1");
  });
});

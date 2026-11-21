import { expect, mock, test } from "bun:test";
import type {
  WorkspaceProcessList,
  WorkspaceProcessStopRequest,
  WorkspaceProcessStopResponse,
  WorkspaceProcessStopResult,
} from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import * as hostConnection from "@/components/layout/host-connection";
import { AppToaster } from "@/components/layout/app-toaster";
import { WorkspaceScopeContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { QueryProvider } from "@/test-utils/query-provider";
import { createWorkspaceRecordFixture } from "@/test-utils/shared-test-fixtures";

// The view reads and stops the processes of a local host only.
mock.module("@/components/layout/host-connection", () => ({
  ...hostConnection,
  useLocalHost: () => "web",
}));

const { ProcessesProvider } = await import("./processes-context");
const { ProcessesFloatingWindow, ProcessesRailButton } = await import("./processes-surfaces");
const { FloatingWindowLayer } = await import("@/components/ui/floating-window");
const { TaskServerLinks } = await import("./task-server-links");

const workspace = createWorkspaceRecordFixture({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
});
const otherWorkspace = createWorkspaceRecordFixture({
  workspaceId: "other",
  workspaceName: "Other",
  repoPath: "/other",
});

const processes = (): WorkspaceProcessList => ({
  issues: [],
  groups: [
    {
      workspaceId: "repo",
      workspaceName: "Repo",
      checkoutPath: "/worktrees/task-1",
      kind: "worktree",
      owners: [{ kind: "task", workspaceId: "repo", taskId: "task-1", title: "Add login" }],
      processes: [
        {
          processRef: "40:400",
          pid: 40,
          name: "pnpm",
          command: "pnpm dev",
          directory: "apps/web",
          stop: { allowed: true, requiresPidReuseAcknowledgment: false, forced: false },
          listeners: [],
        },
        {
          processRef: "41:410",
          pid: 41,
          name: "node",
          command: "node /worktrees/task-1/apps/web/node_modules/.bin/../vite/bin/vite.js",
          parentRef: "40:400",
          directory: "apps/web",
          stop: { allowed: true, requiresPidReuseAcknowledgment: true, forced: false },
          listeners: [
            {
              address: "127.0.0.1",
              port: 5173,
              browser: { kind: "link", url: "http://127.0.0.1:5173/", suggested: true },
            },
          ],
        },
      ],
    },
    {
      workspaceId: "repo",
      workspaceName: "Repo",
      checkoutPath: "/worktrees/empty",
      kind: "worktree",
      owners: [{ kind: "task", workspaceId: "repo", taskId: "task-2", title: "Fix logout" }],
      processes: [],
    },
    {
      workspaceId: "other",
      workspaceName: "Other",
      checkoutPath: "/other",
      kind: "repository",
      owners: [],
      processes: [
        {
          processRef: "60:600",
          pid: 60,
          name: "docker",
          command: "docker compose up",
          directory: "",
          stop: { allowed: true, requiresPidReuseAcknowledgment: false, forced: false },
          listeners: [],
        },
      ],
    },
  ],
});

const mount = (
  input: {
    route?: string;
    list?: () => Promise<WorkspaceProcessList>;
    stop?: () => Promise<WorkspaceProcessStopResult>;
  } = {},
) => {
  const workspaceProcessesList = mock(input.list ?? (async () => processes()));
  const stopOne = input.stop ?? (async () => ({ kind: "stopped" as const }));
  // The host gives each process of the request the same result.
  const workspaceProcessStop = mock(
    async (request: WorkspaceProcessStopRequest): Promise<WorkspaceProcessStopResponse> => {
      const result = await stopOne();
      return { results: request.processRefs.map((processRef) => ({ processRef, result })) };
    },
  );
  const openExternalUrl = mock(async () => {});
  const openCard = mock(() => {});
  const connection = createTestClientConnection({
    client: { workspaceProcessesList, workspaceProcessStop, openExternalUrl },
  });
  const view = render(
    <MemoryRouter initialEntries={[input.route ?? "/kanban"]}>
      <QueryProvider connection={connection}>
        <WorkspaceScopeContext.Provider
          value={{ workspaces: [workspace, otherWorkspace], activeWorkspace: workspace }}
        >
          <FloatingWindowLayer>
            <ProcessesProvider>
              <AppToaster />
              <ProcessesRailButton />
              {/* A card opens its task on a click. */}
              <div role="article" aria-label="Task card" onClick={openCard}>
                <TaskServerLinks taskId="task-1" />
              </div>
              <ProcessesFloatingWindow />
            </ProcessesProvider>
          </FloatingWindowLayer>
        </WorkspaceScopeContext.Provider>
      </QueryProvider>
    </MemoryRouter>,
  );
  /** Opens the flyout with the rail button, once the badge shows the read. */
  const openFlyout = async () => {
    fireEvent.click(
      await view.findByRole("button", { name: /^Processes, \d+ commands? running$/ }),
    );
    return view.findByRole("dialog", { name: "Processes" });
  };
  return {
    view,
    openFlyout,
    workspaceProcessesList,
    workspaceProcessStop,
    openExternalUrl,
    openCard,
  };
};

/** Changes the rows of the first checkout. */
const withRows = (change: (list: WorkspaceProcessList) => void) => async () => {
  const list = processes();
  change(list);
  return list;
};

const STOP_COMMAND = "Stop pnpm dev";
const COMMAND = "apps/web pnpm dev";

test("counts the running commands on the rail and lists them in a flyout", async () => {
  const { view, openFlyout } = mount();
  expect(await view.findByRole("button", { name: "Processes, 2 commands running" })).toBeTruthy();
  const flyout = await openFlyout();
  // The toolbar shows the count while the view is open, so the badge hides.
  expect(view.getByRole("button", { name: "Processes, 2 commands running" }).textContent).toBe("");
  const group = within(flyout).getByRole("region", { name: "Add login" });
  expect(within(group).getByRole("button", { name: COMMAND })).toBeTruthy();
  // A checkout without processes does not show.
  expect(within(flyout).queryByRole("region", { name: "Fix logout" })).toBeNull();
});

test("reads the list again when the app window gets the focus back", async () => {
  const { view, workspaceProcessesList } = mount();
  await view.findByRole("button", { name: "Processes, 2 commands running" });
  const reads = workspaceProcessesList.mock.calls.length;
  window.dispatchEvent(new FocusEvent("focus"));
  await waitFor(() => expect(workspaceProcessesList.mock.calls.length).toBeGreaterThan(reads));
});

test("shows the task that the user works on first and folds the other workspaces", async () => {
  const { openFlyout } = mount({ route: "/sessions?task=task-1" });
  const flyout = await openFlyout();
  const sections = within(flyout).getAllByRole("region");
  const [first] = sections.filter((section) => section.tagName === "SECTION");
  expect(first?.getAttribute("aria-label")).toBe("Add login");
  expect(within(flyout).getByText("This task")).toBeTruthy();
  const other = within(flyout).getByRole("region", { name: "Other" });
  const header = within(other).getByRole("button", { name: /Other/ });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(within(other).queryByRole("button", { name: "docker compose up" })).toBeNull();
});

test("opens a task port from its chip without opening the card", async () => {
  const { view, openExternalUrl, openCard } = mount();
  const card = await view.findByRole("article", { name: "Task card" });
  fireEvent.click(
    await within(card).findByRole("button", { name: /^Open http:\/\/127\.0\.0\.1:5173\// }),
  );
  await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith("http://127.0.0.1:5173/"));
  expect(openCard).not.toHaveBeenCalled();
});

test("detaches the list into a floating window and attaches it back to the rail", async () => {
  const { view, openFlyout } = mount();
  const flyout = await openFlyout();
  fireEvent.click(within(flyout).getByRole("button", { name: "Detach into a floating window" }));
  const window = await view.findByRole("dialog", { name: "Processes" });
  expect(window.tagName).toBe("DIALOG");
  expect(window.hasAttribute("open")).toBe(true);
  expect(within(window).getByRole("button", { name: COMMAND })).toBeTruthy();
  // The window stays when the user clicks elsewhere in the app.
  fireEvent.pointerDown(document.body);
  expect(view.getByRole("dialog", { name: "Processes" })).toBe(window);
  // The rail button closes it, and opens it again as a window.
  const rail = view.getByRole("button", { name: /^Processes, / });
  fireEvent.click(rail);
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Processes" })).toBeNull());
  fireEvent.click(rail);
  const reopened = await view.findByRole("dialog", { name: "Processes" });
  expect(reopened.hasAttribute("data-floating-window")).toBe(true);
  fireEvent.click(within(reopened).getByRole("button", { name: "Attach to the rail" }));
  await waitFor(() =>
    expect(
      view.getByRole("dialog", { name: "Processes" }).hasAttribute("data-floating-window"),
    ).toBe(false),
  );
});

test("opens a command to show each process below the process that started it", async () => {
  const { openFlyout } = mount();
  const flyout = await openFlyout();
  fireEvent.click(within(flyout).getByRole("button", { name: COMMAND }));
  const details = await within(flyout).findByRole("list", { name: "Processes of pnpm dev" });
  expect(within(details).getByText("41")).toBeTruthy();
  const vite = within(details).getByTitle(
    "node /worktrees/task-1/apps/web/node_modules/.bin/../vite/bin/vite.js",
  );
  expect(vite.textContent).toBe("node vite/bin/vite.js");
});

test("stops a command with every process that it started", async () => {
  const { view, openFlyout, workspaceProcessStop } = mount();
  const flyout = await openFlyout();
  fireEvent.click(within(flyout).getByRole("button", { name: STOP_COMMAND }));
  const confirm = await view.findByRole("dialog", { name: /^Stop\s+pnpm dev\s*\?$/ });
  expect(confirm.textContent).toContain("apps/web · 2 processes · :5173");
  expect(within(confirm).getByText(/the system reuses its ID/)).toBeTruthy();
  fireEvent.click(within(confirm).getByRole("button", { name: "Stop" }));
  await waitFor(() =>
    expect(workspaceProcessStop).toHaveBeenCalledWith({
      workspaceId: "repo",
      checkoutPath: "/worktrees/task-1",
      processRefs: ["40:400", "41:410"],
      acknowledgedPidReuseRisk: true,
    }),
  );
});

test("reads the list again after a stop, also with readers of the cache open", async () => {
  const { openFlyout, view, workspaceProcessesList } = mount();
  const flyout = await openFlyout();
  const reads = workspaceProcessesList.mock.calls.length;
  fireEvent.click(within(flyout).getByRole("button", { name: STOP_COMMAND }));
  fireEvent.click(await view.findByRole("button", { name: "Stop" }));
  await waitFor(() => expect(workspaceProcessesList.mock.calls.length).toBeGreaterThan(reads));
});

test("marks a command out of date when the host cannot verify it", async () => {
  let reads = 0;
  const { view, openFlyout } = mount({
    stop: async () => ({
      kind: "out_of_date",
      issue: {
        message: "This process now runs in another checkout.",
        nextAction: "Refresh the list.",
      },
    }),
    // The refresh after the outcome never ends, so the command stays out of date.
    list: () => (reads++ === 0 ? Promise.resolve(processes()) : new Promise(() => {})),
  });
  const flyout = await openFlyout();
  fireEvent.click(within(flyout).getByRole("button", { name: STOP_COMMAND }));
  fireEvent.click(await view.findByRole("button", { name: "Stop" }));
  expect(
    await view.findByText("This process now runs in another checkout. (2 processes)"),
  ).toBeTruthy();
  expect(await within(flyout).findByText("Out of date")).toBeTruthy();
  expect(within(flyout).getByRole("button", { name: STOP_COMMAND }).hasAttribute("disabled")).toBe(
    true,
  );
});

test("shows a partial read instead of the empty state", async () => {
  const { view } = mount({
    list: async () => ({
      groups: [],
      issues: [{ message: "OpenDucktor cannot read /work/task-a.", nextAction: "Fix access." }],
    }),
  });
  await waitFor(() => expect(view.getByRole("button", { name: "Processes" })).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Processes" }));
  const flyout = await view.findByRole("dialog", { name: "Processes" });
  fireEvent.click(
    await within(flyout).findByRole("button", { name: "Some processes may be missing" }),
  );
  expect(await view.findByText("OpenDucktor cannot read /work/task-a.")).toBeTruthy();
  expect(within(flyout).getByText("No processes found")).toBeTruthy();
});

test("shows why a command cannot stop", async () => {
  const reason = "OpenDucktor cannot tell this process apart from the runtime.";
  const { openFlyout } = mount({
    list: withRows((list) => {
      for (const row of list.groups[0]?.processes ?? [])
        row.stop = { allowed: false, issue: { message: reason, nextAction: "Stop the session." } };
    }),
  });
  const flyout = await openFlyout();
  const stop = within(flyout).getByRole("button", { name: STOP_COMMAND });
  expect(stop.hasAttribute("disabled")).toBe(true);
  expect(stop.getAttribute("title")).toBe(reason);
});

test("folds the processes that another app started behind one line", async () => {
  const { openFlyout } = mount({
    list: withRows((list) => {
      list.groups[0]?.processes.push({
        processRef: "50:500",
        pid: 50,
        name: "node",
        command: "node json-language-server --stdio",
        launcher: "Zed",
        stop: { allowed: true, requiresPidReuseAcknowledgment: false, forced: false },
        listeners: [],
      });
    }),
  });
  const flyout = await openFlyout();
  const zed = within(flyout).getByRole("button", { name: "Zed · 1 process" });
  expect(within(flyout).queryByTitle("node json-language-server --stdio")).toBeNull();
  fireEvent.click(zed);
  expect(await within(flyout).findByTitle("node json-language-server --stdio")).toBeTruthy();
  expect(within(flyout).getByText("2 commands · 1 port")).toBeTruthy();
});

test("says when the system ends the process at once", async () => {
  const { view, openFlyout } = mount({
    list: withRows((list) => {
      for (const row of list.groups[0]?.processes ?? [])
        row.stop = { allowed: true, requiresPidReuseAcknowledgment: false, forced: true };
    }),
  });
  const flyout = await openFlyout();
  fireEvent.click(within(flyout).getByRole("button", { name: STOP_COMMAND }));
  const confirm = await view.findByRole("dialog", { name: /^Stop\s+pnpm dev\s*\?$/ });
  expect(within(confirm).getByText(/The system ends each process at once/)).toBeTruthy();
  expect(within(confirm).queryByText(/the system reuses its ID/)).toBeNull();
});

test("filters with the keyboard: Enter opens a port, ArrowDown moves into the list", async () => {
  const { openFlyout, openExternalUrl } = mount();
  const flyout = await openFlyout();
  const filter = within(flyout).getByLabelText("Filter processes");
  await waitFor(() => expect(document.activeElement).toBe(filter));
  fireEvent.change(filter, { target: { value: "vite" } });
  fireEvent.keyDown(filter, { key: "Enter" });
  await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith("http://127.0.0.1:5173/"));
  fireEvent.keyDown(filter, { key: "ArrowDown" });
  const command = within(flyout).getByRole("button", { name: COMMAND });
  expect(document.activeElement).toBe(command);
  fireEvent.keyDown(command, { key: "ArrowLeft" });
  fireEvent.keyDown(command, { key: "ArrowUp" });
  expect(document.activeElement).toBe(filter);
});

test("shows filter results at once, without motion", async () => {
  const { openFlyout } = mount();
  const flyout = await openFlyout();
  const filter = within(flyout).getByLabelText("Filter processes");
  fireEvent.change(filter, { target: { value: "docker" } });
  // The checkout without a match leaves at once, with no exit motion to wait for.
  expect(within(flyout).queryByRole("region", { name: "Add login", hidden: true })).toBeNull();
  expect(within(flyout).getByRole("region", { name: "Other" })).toBeTruthy();
  fireEvent.change(filter, { target: { value: "" } });
  const back = await within(flyout).findByRole("region", { name: "Add login" });
  expect(back.getAttribute("data-animate-entry")).toBe("false");
});

test("clears the filter with the first Escape and closes the flyout with the next", async () => {
  const { view, openFlyout } = mount();
  const flyout = await openFlyout();
  const filter = within(flyout).getByLabelText("Filter processes");
  fireEvent.change(filter, { target: { value: "postgres" } });
  expect(await within(flyout).findByText("No command matches “postgres”")).toBeTruthy();
  fireEvent.keyDown(filter, { key: "Escape" });
  await waitFor(() => expect(filter.getAttribute("value") ?? "").toBe(""));
  expect(view.getByRole("dialog", { name: "Processes" })).toBeTruthy();
  fireEvent.keyDown(filter, { key: "Escape" });
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Processes" })).toBeNull());
});

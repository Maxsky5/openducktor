import { expect, mock, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionArchiveInput } from "@openducktor/contracts";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { usePublishVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import { buildSessionNavigationHref } from "@/features/session-navigation/session-navigation-target";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "@/state/queries/workspace-sessions";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionNavigationRail } from "./session-navigation-rail";
import { SessionNavigationTestProvider } from "./session-navigation-test-provider";
import {
  betaWorkspace,
  navigationModel,
  NOW,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

type Layout = "list" | "rail";
function MenuHarness({
  layout,
  entries,
  selected,
  onOpen,
}: {
  layout: Layout;
  entries: SessionNavigationEntry[];
  selected: SessionNavigationEntry | null;
  onOpen: (entry: SessionNavigationEntry) => void;
}) {
  const records = useQuery({ ...workspaceSessionListQueryOptions("beta"), enabled: false });
  const visible = entries.flatMap((entry) => {
    if (entry.context.kind !== "workspace") return [entry];
    const id = entry.context.session.id;
    const record = records.data?.find((record) => record.id === id);
    return record
      ? [
          {
            ...entry,
            title: record.manualTitle ?? entry.title,
            context: { kind: "workspace" as const, session: record },
          },
        ]
      : [];
  });
  const current = visible.find((entry) => entry.key === selected?.key);
  usePublishVisibleSessionTarget(
    current?.target ?? null,
    current?.context.kind === "workspace"
      ? workspaceSessionIdentity(current.context.session)
      : null,
  );
  const location = useLocation();
  const List = layout === "list" ? SessionNavigationList : SessionNavigationRail;
  return (
    <>
      <output aria-label="Current address">
        {location.pathname}
        {location.search}
      </output>
      <Link to="/kanban">Kanban</Link>
      <List
        model={navigationModel({ recent: visible })}
        selection={{ entryKey: selected?.key ?? null, visibleKey: selected?.key ?? null }}
        now={NOW}
        onOpen={onOpen}
        onRetry={() => {}}
      />
    </>
  );
}
const renderMenu = (
  layout: Layout,
  entries: SessionNavigationEntry[],
  selected: SessionNavigationEntry | null = null,
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(
    workspaceSessionQueryKeys.list("beta", false),
    entries.flatMap((entry) => (entry.context.kind === "workspace" ? [entry.context.session] : [])),
  );
  const onOpen = mock((_entry: SessionNavigationEntry) => {});
  const view = render(
    <MemoryRouter
      initialEntries={[
        selected
          ? buildSessionNavigationHref(selected.target)
          : "/sessions?workspace=alpha&kind=task",
      ]}
    >
      <WorkspacePreviewTransitionGuardProvider>
        <SessionNavigationTestProvider client={client}>
          <MenuHarness layout={layout} entries={entries} selected={selected} onOpen={onOpen} />
        </SessionNavigationTestProvider>
      </WorkspacePreviewTransitionGuardProvider>
    </MemoryRouter>,
  );
  return { ...view, client, onOpen };
};
const openMenu = async (view: ReturnType<typeof renderMenu>, title: string) => {
  fireEvent.contextMenu(view.getByRole("button", { name: new RegExp(title) }), {
    button: 2,
    clientX: 20,
    clientY: 40,
  });
  return within(await view.findByRole("menu"));
};
const chatEntry = (id: string) => workspaceSessionEntry(id, { workspace: betaWorkspace });
const chatRecord = (entry: SessionNavigationEntry): WorkspaceSession => {
  if (entry.context.kind !== "workspace") throw new Error("Expected a workspace session");
  return entry.context.session;
};

test.each(["list", "rail"] as const)(
  "%s context menu marks only its session and copies the saved task identity without navigation",
  async (layout) => {
    const entry = taskSessionEntry("same-id", { workspace: betaWorkspace });
    if (entry.target.kind !== "task_session") throw new Error("Expected task identity");
    entry.target.identity.workingDirectory = "/repos/beta/worktrees/exact";
    const other = taskSessionEntry("other");
    const copied: string[] = [];
    const restoreClipboard = replaceNavigatorClipboard(async (value) => {
      copied.push(value);
    });
    const view = renderMenu(layout, [entry, other], entry);
    try {
      const initialAddress = view.getByLabelText("Current address").textContent;
      let menu = await openMenu(view, entry.title);
      expect(menu.queryByRole("menuitem", { name: "Rename session" })).toBeNull();
      expect(menu.queryByRole("menuitem", { name: "Archive session" })).toBeNull();
      expect(view.queryByRole("dialog") === null).toBe(true);
      fireEvent.click(menu.getByRole("menuitem", { name: "Mark as unread" }));
      const row = view.getByRole("button", { name: new RegExp(entry.title) });
      expect(within(row).getByRole("img", { name: "Unread session" })).toBeTruthy();
      expect(
        within(view.getByRole("button", { name: new RegExp(other.title) })).getByRole("img", {
          name: "Session read",
        }),
      ).toBeTruthy();
      menu = await openMenu(view, entry.title);
      fireEvent.click(menu.getByRole("menuitem", { name: "Copy working directory" }));
      await waitFor(() => expect(copied).toEqual(["/repos/beta/worktrees/exact"]));
      menu = await openMenu(view, entry.title);
      fireEvent.click(menu.getByRole("menuitem", { name: "Copy external session ID" }));
      await waitFor(() => expect(copied).toEqual(["/repos/beta/worktrees/exact", "same-id"]));
      expect(view.onOpen).not.toHaveBeenCalled();
      expect(view.getByLabelText("Current address").textContent).toBe(initialAddress);
      fireEvent.click(row);
      expect(within(row).getByRole("img", { name: "Session read" })).toBeTruthy();
      menu = await openMenu(view, entry.title);
      fireEvent.click(menu.getByRole("menuitem", { name: "Mark as unread" }));
      fireEvent.keyDown(row, { key: "F10", shiftKey: true });
      menu = within(await view.findByRole("menu"));
      fireEvent.click(menu.getByRole("menuitem", { name: "Mark as read" }));
      expect(within(row).getByRole("img", { name: "Session read" })).toBeTruthy();
    } finally {
      view.unmount();
      view.client.clear();
      restoreClipboard();
    }
  },
);

test("workspace menu copies the external ID and renames in its own workspace without changing the page", async () => {
  const entry = chatEntry("saved-id");
  const record = chatRecord(entry);
  record.externalSessionId = "native-id";
  const renamed = { ...record, manualTitle: "Renamed chat" };
  const rename = mock(
    async (_input: { workspaceId: string; sessionId: string; manualTitle: string | null }) =>
      renamed,
  );
  const copied: string[] = [];
  const restoreClipboard = replaceNavigatorClipboard(async (value) => {
    copied.push(value);
  });
  configureShellBridge(createShellBridgeFixture({ client: { workspaceSessionRename: rename } }));
  const view = renderMenu("list", [entry]);
  try {
    let menu = await openMenu(view, entry.title);
    fireEvent.click(menu.getByRole("menuitem", { name: "Copy external session ID" }));
    await waitFor(() => expect(copied).toEqual(["native-id"]));
    menu = await openMenu(view, entry.title);
    fireEvent.click(menu.getByRole("menuitem", { name: "Rename session" }));
    const dialog = within(await view.findByRole("dialog", { name: "Rename chat" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Name" }), {
      target: { value: "Renamed chat" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    // Printing a DOM node on a failed poll can block the timer that closes the dialog.
    await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true));
    expect(rename).toHaveBeenCalledWith({
      workspaceId: "beta",
      sessionId: "saved-id",
      manualTitle: "Renamed chat",
    });
    expect(
      view.client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("beta", false)),
    ).toEqual([renamed]);
    expect(view.getByRole("button", { name: /Renamed chat/ })).toBeTruthy();
    expect(view.onOpen).not.toHaveBeenCalled();
    expect(view.getByLabelText("Current address").textContent).toBe(
      "/sessions?workspace=alpha&kind=task",
    );
  } finally {
    view.unmount();
    view.client.clear();
    restoreClipboard();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(
  (["menu", "preview"] as const).flatMap((source) =>
    (["background", "selected", "left"] as const).map((selection) => [source, selection] as const),
  ),
)(
  "archive from the sidebar %s waits for confirmation and keeps the correct selection: %s",
  async (source, selection) => {
    const entry = chatEntry("archive");
    const remaining = chatEntry("keep");
    const record = chatRecord(entry);
    const done = Promise.withResolvers<WorkspaceSession>();
    const archive = mock((_input: WorkspaceSessionArchiveInput) => done.promise);
    configureShellBridge(
      createShellBridgeFixture({ client: { workspaceSessionArchive: archive } }),
    );
    const view = renderMenu("list", [entry, remaining], selection === "background" ? null : entry);
    const row = view.getByRole("button", { name: new RegExp(entry.title) });
    const openArchive = async () => {
      if (source === "menu") {
        const menu = await openMenu(view, entry.title);
        fireEvent.click(menu.getByRole("menuitem", { name: "Archive session" }));
      } else {
        fireEvent.focus(row);
        const preview = await view.findByRole("dialog", { name: entry.title });
        fireEvent.keyDown(row, { key: "ArrowRight" });
        const header = preview.querySelector("header");
        if (!header) throw new Error("Expected a preview header.");
        fireEvent.click(within(header).getByRole("button", { name: "Archive session" }));
      }
      const dialog = await view.findByRole("dialog", { name: "Archive chat" });
      await waitFor(() =>
        expect(view.queryByRole("dialog", { name: entry.title }) === null).toBe(true),
      );
      return within(dialog);
    };
    try {
      let dialog = await openArchive();
      expect(dialog.getByText(record.executionTarget.workingDirectory)).toBeTruthy();
      expect(archive).not.toHaveBeenCalled();
      fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true));
      await waitFor(() => expect(document.activeElement === row).toBe(true));
      expect(archive).not.toHaveBeenCalled();
      dialog = await openArchive();
      fireEvent.click(dialog.getByRole("button", { name: "Archive chat" }));
      await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
      expect(archive).toHaveBeenCalledWith({
        workspaceId: "beta",
        sessionId: "archive",
        confirmStop: true,
        removeWorktree: false,
      });
      expect(dialog.getByRole("button", { name: "Archiving…" }).hasAttribute("disabled")).toBe(
        true,
      );
      if (selection === "left")
        fireEvent.click(view.getByRole("link", { name: "Kanban", hidden: true }));
      await act(async () => {
        view.client.setQueryData(workspaceSessionQueryKeys.list("beta", false), [
          chatRecord(remaining),
        ]);
      });
      await act(async () => done.resolve({ ...record, archivedAt: NOW }));
      await waitFor(() => expect(view.queryByRole("dialog") === null).toBe(true));
      expect(view.queryByRole("button", { name: /Chat archive/ })).toBeNull();
      expect(view.getByRole("button", { name: /Chat keep/ })).toBeTruthy();
      expect(view.getByLabelText("Current address").textContent).toBe(
        selection === "selected"
          ? "/sessions?workspace=beta&kind=workspace&session=keep"
          : selection === "left"
            ? "/kanban"
            : "/sessions?workspace=alpha&kind=task",
      );
    } finally {
      view.unmount();
      view.client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

import { beforeEach, describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { createTerminalSessionsFixture } from "@/test-utils/session-panel-fixtures";
import { type SessionPanelOwner, sessionPanelOwnerKey } from "./session-panel-layout";
import { type SessionPanelsModel, useSessionPanels } from "./use-session-panels";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import { withMockedToast } from "@/test-utils/mock-toast";

import {
  expectPanelSlidesOut,
  hostTab,
  layoutStore,
  newTaskOwner,
  placeOpenTerminal,
  reload,
  renderBrowserPanels,
  renderPanels,
  savedBottom,
  savedBrowserEntry,
  saveLayout,
  saveOpen,
  startTestConnection,
  TAB_1,
  TAB_2,
  terminalTab,
  testConnection,
  WITHOUT_CI_CHECKS,
} from "./session-panels-test-harness";

beforeEach(startTestConnection);

/** The panels model of the shown view in its last render. */
type ShownModel = { shown: SessionPanelsModel | null };

/** One session view of an owner. It reports its panels model on each render. */
const PanelsView = ({
  owner,
  tabs,
  isActive,
  onModel,
}: {
  owner: SessionPanelOwner;
  tabs: TerminalTab[];
  isActive: boolean;
  onModel: (model: SessionPanelsModel) => void;
}) => (
  <SessionViewContext value={{ id: isActive ? "shown" : "kept", isActive }}>
    <PanelsModel owner={owner} tabs={tabs} onModel={onModel} />
  </SessionViewContext>
);

const PanelsModel = ({
  owner,
  tabs,
  onModel,
}: {
  owner: SessionPanelOwner;
  tabs: TerminalTab[];
  onModel: (model: SessionPanelsModel) => void;
}) => {
  const terminals = createTerminalSessionsFixture({ scopeKey: sessionPanelOwnerKey(owner), tabs });
  const model = useSessionPanels({
    owner,
    selectionKey: "build",
    unavailableKinds: WITHOUT_CI_CHECKS,
    terminals,
  });
  useEffect(() => {
    onModel(model);
  }, [model, onModel]);
  return null;
};

describe("useSessionPanels open state", () => {
  test("a kept view that renders in the same commit never saves over the shown view", () => {
    const owner = newTaskOwner();
    placeOpenTerminal(owner);
    const latest: ShownModel = { shown: null };
    // The shown view comes first, so the kept view runs its effects after it.
    const tree = (tabs: TerminalTab[]) => (
      <ClientConnectionProvider connection={testConnection()}>
        <PanelsView
          owner={owner}
          tabs={tabs}
          isActive
          onModel={(model) => (latest.shown = model)}
        />
        <PanelsView owner={owner} tabs={tabs} isActive={false} onModel={() => {}} />
      </ClientConnectionProvider>
    );
    const view = render(tree([terminalTab("terminal-1")]));
    try {
      // The shown view saves its check without a notice, so the kept view can hold an older one.
      layoutStore().writeBottomCheck(owner, { tabCount: 2, wasOpen: true });
      view.rerender(tree([]));

      expect(latest.shown?.bottomToggle.isOpen).toBe(false);
      expect(savedBottom(owner)).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test("each task keeps its own panel state, and the views of one task share it", () => {
    const owner = newTaskOwner();
    // The views of one task show the same terminal list.
    const terminals = { tabs: [terminalTab("terminal-1", "host")] };
    const shown = renderPanels(owner, terminals);
    const kept = renderPanels(owner, terminals);
    const other = renderPanels(newTaskOwner(), {});
    try {
      act(() => shown.result.current.rightToggle?.onToggle());
      act(() => shown.result.current.bottomToggle.onToggle());
      expect(kept.result.current.rightToggle?.isOpen).toBe(false);
      expect(kept.result.current.bottomToggle.isOpen).toBe(true);
      expect(other.result.current.rightToggle?.isOpen).toBe(true);
      expect(other.result.current.bottomToggle.isOpen).toBe(false);

      act(() => kept.result.current.rightToggle?.onToggle());
      expect(shown.result.current.rightToggle?.isOpen).toBe(true);
    } finally {
      shown.unmount();
      kept.unmount();
      other.unmount();
    }
  });

  test("a hidden view ends its panel slides and takes shared changes at once", () => {
    const owner = newTaskOwner();
    const kept = renderPanels(owner, {});
    const shown = renderPanels(owner, {});
    try {
      act(() => kept.result.current.rightToggle?.onToggle());
      expect(kept.result.current.right.presence).toBe("closing");
      act(() => kept.setActive(false));
      expect(kept.result.current.right.presence).toBe("closed");

      // A hidden view has no size and no transition, so a slide in it could not end.
      act(() => shown.result.current.rightToggle?.onToggle());
      expect(shown.result.current.right.presence).toBe("opening");
      expect(kept.result.current.right.presence).toBe("open");
    } finally {
      shown.unmount();
      kept.unmount();
    }
  });

  test("restores the panels of each task without a slide after a reload", () => {
    const first = newTaskOwner();
    const second = newTaskOwner();
    const firstView = renderPanels(first, { tabs: [terminalTab("terminal-1", "host")] });
    act(() => firstView.result.current.rightToggle?.onToggle());
    act(() => firstView.result.current.bottomToggle.onToggle());
    const secondView = renderPanels(second, { tabs: [terminalTab("terminal-2")] });
    act(() => secondView.result.current.bottomToggle.onToggle());
    firstView.unmount();
    secondView.unmount();

    reload();
    const restoredFirst = renderPanels(first, { tabs: [terminalTab("terminal-1", "host")] });
    const restoredSecond = renderPanels(second, { tabs: [terminalTab("terminal-2")] });

    expect(restoredFirst.result.current.right.presence).toBe("closed");
    expect(restoredFirst.result.current.bottom.presence).toBe("open");
    // A saved closed bottom panel stays closed, also with a terminal that the user started.
    expect(restoredSecond.result.current.right.presence).toBe("open");
    expect(restoredSecond.result.current.bottom.presence).toBe("closed");
  });

  test("keeps a restored open bottom panel closed until the terminal list has a tab", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);
    reload();
    const view = renderPanels(owner, { isLoading: true, isSynced: false });
    expect(view.result.current.bottom.presence).toBe("closed");
    expect(view.result.current.bottomToggle.isOpen).toBe(false);

    view.setTerminals({ tabs: [terminalTab("terminal-1", "host")] });

    expect(view.result.current.bottom.presence).toBe("open");
    expect(view.starts).toEqual([]);
  });

  test("saves a restored bottom panel closed when its terminals ended", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);
    reload();
    const view = renderPanels(owner, { isLoading: true, isSynced: false });

    view.setTerminals({});

    expect(view.result.current.bottom.presence).toBe("closed");
    expect(view.starts).toEqual([]);
    expect(savedBottom(owner)).toBe(false);
    // A later terminal that the user started does not show the saved closed panel.
    view.setTerminals({ tabs: [terminalTab("terminal-1")] });
    expect(view.result.current.bottom.presence).toBe("closed");
  });

  test("shows a restored open bottom panel when terminal discovery fails", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);
    reload();
    const view = renderPanels(owner, { isLoading: true, isSynced: false });

    view.setTerminals({ isSynced: false, discoveryError: "Offline." });

    expect(view.result.current.bottom.presence).toBe("open");
    expect(view.result.current.bottom.launcher[0]?.recovery?.label).toBe(
      "Retry terminal discovery",
    );
  });

  test("opens a restored bottom panel at once when the user toggles it during the restore", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);
    reload();
    const view = renderPanels(owner, { isLoading: true, isSynced: false });

    act(() => view.result.current.bottomToggle.onToggle());

    expect(view.result.current.bottomToggle.isOpen).toBe(true);
    view.setTerminals({});
    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(savedBottom(owner)).toBe(true);
  });

  test("keeps a hide of the user when a terminal close fails", async () => {
    await withMockedToast(async () => {
      const owner = newTaskOwner();
      const tabs = [terminalTab("terminal-1"), terminalTab("terminal-2")];
      let failClose: (cause: Error) => void = () => {};
      const onClose: TerminalSessionsModel["onClose"] = () =>
        new Promise((_resolve, reject) => {
          failClose = reject;
        });
      const view = renderPanels(owner, { tabs, onClose });
      expect(view.result.current.bottom.isVisible).toBe(true);

      act(() => view.result.current.bottom.onClose("terminal:tab:terminal-1"));
      view.setTerminals({ tabs, onClose, closingTabIds: new Set(["tab:terminal-1"]) });
      act(() => view.result.current.bottomToggle.onToggle());
      await act(async () => failClose(new Error("The host is not ready.")));
      view.setTerminals({ tabs, onClose });

      expect(view.result.current.bottomToggle.isOpen).toBe(false);
      expect(savedBottom(owner)).toBe(false);
      expect(view.result.current.bottom.tabs).toHaveLength(2);
    });
  });

  test("saves the open bottom panel of a new view closed when its last terminal closes", () => {
    const owner = newTaskOwner();
    placeOpenTerminal(owner);
    const tabs = [terminalTab("terminal-1")];
    const view = renderPanels(owner, { tabs, closingTabIds: new Set(["tab:terminal-1"]) });

    view.setTerminals({ tabs: [] });

    expect(view.result.current.bottom.isVisible).toBe(false);
    expect(savedBottom(owner)).toBe(false);
  });

  test("shows an empty bottom panel that the user opened earlier in the same run", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);

    const view = renderPanels(owner, {});

    expect(view.result.current.bottom.presence).toBe("open");
    expect(savedBottom(owner)).toBe(true);
  });

  test("a kept role view keeps a Show that ended the restore in the shown view", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);
    reload();
    // The terminals cannot start, so the opened panel stays empty.
    const loading = { isLoading: true, isSynced: false, createTerminal: () => null };
    const shown = renderPanels(owner, loading);
    const kept = renderPanels(owner, loading);
    act(() => kept.setActive(false));
    try {
      act(() => shown.result.current.bottomToggle.onToggle());
      expect(shown.result.current.bottomToggle.isOpen).toBe(true);

      kept.setTerminals({ createTerminal: () => null });
      shown.setTerminals({ createTerminal: () => null });

      expect(shown.result.current.bottom.isVisible).toBe(true);
      expect(kept.result.current.bottomToggle.isOpen).toBe(true);
      expect(savedBottom(owner)).toBe(true);
    } finally {
      shown.unmount();
      kept.unmount();
    }
  });

  test("a kept role view keeps a Show made while the last terminal closes", () => {
    const owner = newTaskOwner();
    placeOpenTerminal(owner);
    const tabs = [terminalTab("terminal-1")];
    const closing = { tabs, closingTabIds: new Set(["tab:terminal-1"]) };
    const shown = renderPanels(owner, { tabs });
    const kept = renderPanels(owner, { tabs });
    act(() => kept.setActive(false));
    try {
      kept.setTerminals(closing);
      shown.setTerminals(closing);
      act(() => shown.result.current.bottomToggle.onToggle());
      expect(shown.result.current.bottomToggle.isOpen).toBe(true);

      kept.setTerminals({ tabs: [] });
      shown.setTerminals({ tabs: [] });

      expect(shown.result.current.bottom.isVisible).toBe(true);
      expect(kept.result.current.bottomToggle.isOpen).toBe(true);
      expect(savedBottom(owner)).toBe(true);
    } finally {
      shown.unmount();
      kept.unmount();
    }
  });

  test("a kept view saves an automatic close only once it shows", () => {
    const owner = newTaskOwner();
    placeOpenTerminal(owner);
    const view = renderPanels(owner, { tabs: [terminalTab("terminal-1")] });
    act(() => view.setActive(false));

    view.setTerminals({ tabs: [] });
    expect(savedBottom(owner)).toBe(true);

    act(() => view.setActive(true));
    expect(view.result.current.bottomToggle.isOpen).toBe(false);
    expect(savedBottom(owner)).toBe(false);
  });

  test("keeps an open bottom panel when a view of the task mounts again and loads its terminals", () => {
    const owner = newTaskOwner();
    saveOpen(owner, "bottom", true);
    const tabs = [terminalTab("terminal-1")];
    const first = renderPanels(owner, { tabs });
    expect(first.result.current.bottom.presence).toBe("open");
    first.unmount();

    const second = renderPanels(owner, { isLoading: true, isSynced: false });
    expect(savedBottom(owner)).toBe(true);

    second.setTerminals({ tabs });
    expect(second.result.current.bottom.presence).toBe("open");
    expect(savedBottom(owner)).toBe(true);
  });

  test("saves the bottom panel closed when it hides after its last tab", () => {
    const owner = newTaskOwner();
    const view = renderPanels(owner, { tabs: [terminalTab("terminal-1")] });
    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(savedBottom(owner)).toBeNull();

    view.setTerminals({ tabs: [] });

    expectPanelSlidesOut(view, "bottom");
    expect(savedBottom(owner)).toBe(false);
  });
});

describe("useSessionPanels open state with browser tabs", () => {
  test("keeps a saved closed right panel when the first list finds or the panels start an agent tab", () => {
    const owner = newTaskOwner();
    saveLayout(owner, [savedBrowserEntry(TAB_1), savedBrowserEntry(TAB_2)]);
    saveOpen(owner, "right", false);
    const agentTab = (tabId: string, started: boolean) =>
      hostTab(tabId, {
        createdBy: "agent",
        started,
        owner: { kind: "task", workspaceId: owner.workspaceId, taskId: "task-1" },
      });
    const view = renderBrowserPanels(owner, { isSynced: false });

    view.setBrowser({ tabs: [agentTab(TAB_1, true), agentTab(TAB_2, false)] });
    expect(view.calls.started).toEqual([TAB_2]);
    view.setBrowser({ tabs: [agentTab(TAB_1, true), agentTab(TAB_2, true)] });

    expect(view.result.current.rightToggle?.isOpen).toBe(false);
    expect(layoutStore().readPanels(owner).right).toBe(false);
  });

  test("keeps the saved open bottom panel through a failed close of its last tab", () => {
    const owner = newTaskOwner();
    saveLayout(owner, [], [savedBrowserEntry(TAB_1)]);
    saveOpen(owner, "bottom", true);
    const tabs = [hostTab(TAB_1)];
    const view = renderBrowserPanels(owner, { tabs });
    expect(view.result.current.bottom.presence).toBe("open");

    // The tab hides while the host closes it, then comes back when the close fails.
    view.setBrowser({ tabs, closingTabIds: new Set([TAB_1]) });
    expect(view.result.current.bottomToggle.isOpen).toBe(false);
    view.setBrowser({ tabs });
    expect(view.result.current.bottomToggle.isOpen).toBe(true);
    expect(savedBottom(owner)).toBe(true);

    // A close that succeeds saves the panel closed.
    view.setBrowser({ tabs, closingTabIds: new Set([TAB_1]) });
    view.setBrowser({ tabs: [] });
    expect(view.result.current.bottomToggle.isOpen).toBe(false);
    expect(savedBottom(owner)).toBe(false);
  });

  test("keeps a restore pending when the browser list drops a saved tab before terminals load", () => {
    const owner = newTaskOwner();
    saveLayout(owner, [], [savedBrowserEntry(TAB_1)]);
    saveOpen(owner, "bottom", true);
    reload();
    const view = renderBrowserPanels(
      owner,
      { isSynced: false },
      { terminals: { isLoading: true, isSynced: false } },
    );
    expect(view.result.current.bottom.isVisible).toBe(false);

    view.setBrowser({ tabs: [] });
    expect(view.result.current.bottom.isVisible).toBe(false);
    expect(savedBottom(owner)).toBe(true);

    view.setTerminals({ tabs: [terminalTab("terminal-1", "host")] });
    expect(view.result.current.bottom.presence).toBe("open");
  });
});

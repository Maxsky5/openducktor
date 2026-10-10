import type { SessionPanelModel, SessionPanelsModel } from "@/features/session-panels";
import type { TerminalSessionsModel } from "@/features/terminals";

export const createTerminalSessionsFixture = (
  overrides: Partial<TerminalSessionsModel> = {},
): TerminalSessionsModel => ({
  scopeKey: null,
  isAvailable: true,
  startBlockedReason: null,
  tabs: [],
  closingTabIds: new Set(),
  runningCommandTerminalIds: new Set(),
  isSynced: true,
  mountedTabs: [],
  isLoading: false,
  discoveryError: null,
  transportError: null,
  platform: undefined,
  platformError: null,
  controller: null,
  createTerminal: () => null,
  onRetryDiscovery: () => {},
  onRetryCreate: () => {},
  onTitleChange: () => {},
  onClose: async () => ({ closed: true }),
  onLifecycle: () => {},
  onForgotten: () => {},
  ...overrides,
});

/** A right panel with Diffs and Files tabs. A hidden panel has the closed presence. */
export const createSessionPanelFixture = (
  overrides: Partial<SessionPanelModel> = {},
): SessionPanelModel => {
  const isVisible = overrides.isVisible ?? overrides.presence !== "closed";
  const model: SessionPanelModel = {
    panel: "right",
    presence: isVisible ? "open" : "closed",
    onSettled: () => {},
    onCollapsed: () => {},
    isVisible,
    activeKind: null,
    tabs: [
      { id: "diffs", kind: "diffs" },
      { id: "files", kind: "files" },
    ],
    selectedTabId: "diffs",
    launcher: [],
    focusRequest: 0,
    terminals: createTerminalSessionsFixture(),
    terminalMounts: [],
    activeTerminalKey: null,
    onSelect: () => {},
    onClose: () => {},
    onAddTab: () => {},
    onPick: () => {},
    onHide: null,
    ...overrides,
  };
  const selectedKind = model.tabs.find((tab) => tab.id === model.selectedTabId)?.kind ?? null;
  return {
    ...model,
    activeKind: overrides.activeKind ?? (model.isVisible ? selectedKind : null),
  };
};

export const createSessionPanelsFixture = (
  overrides: Partial<SessionPanelsModel> = {},
): SessionPanelsModel => ({
  right: createSessionPanelFixture(),
  bottom: createSessionPanelFixture({
    panel: "bottom",
    tabs: [],
    selectedTabId: null,
    isVisible: false,
  }),
  rightToggle: { isOpen: true, onToggle: () => {} },
  bottomToggle: { isAvailable: true, isOpen: false, onToggle: () => {} },
  runAction: () => {},
  startBlockedReason: null,
  canMove: () => false,
  onMove: () => {},
  onDrop: () => {},
  terminalClose: { candidate: null, isConfirming: false, onConfirm: () => {}, onCancel: () => {} },
  platformError: null,
  ...overrides,
});

import type { TerminalScopePresentation, TerminalTab } from "./terminal-presentation-state";

export type MountedTerminalTab = {
  scopeKey: string;
  tab: TerminalTab;
};

export type MountedTerminalTabsSnapshot = {
  mountedTabs: MountedTerminalTab[];
  scopeKeys: readonly string[];
  tabsByScope: readonly (readonly TerminalTab[])[];
};

const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = [];

const sameMountedScopes = (
  previous: MountedTerminalTabsSnapshot,
  scopeKeys: readonly string[],
  tabsByScope: readonly (readonly TerminalTab[])[],
): boolean => {
  if (previous.scopeKeys.length !== scopeKeys.length) return false;
  return scopeKeys.every(
    (scopeKey, index) =>
      previous.scopeKeys[index] === scopeKey && previous.tabsByScope[index] === tabsByScope[index],
  );
};

export const reconcileMountedTerminalTabs = (
  previous: MountedTerminalTabsSnapshot | undefined,
  scopeKeys: readonly string[],
  scopes: Readonly<Record<string, TerminalScopePresentation | undefined>>,
): MountedTerminalTabsSnapshot => {
  const tabsByScope = scopeKeys.map((scopeKey) => scopes[scopeKey]?.tabs ?? EMPTY_TERMINAL_TABS);
  if (previous && sameMountedScopes(previous, scopeKeys, tabsByScope)) return previous;

  const previousByScope = new Map<string, Map<string, MountedTerminalTab>>();
  for (const mountedTab of previous?.mountedTabs ?? []) {
    const byTabId = previousByScope.get(mountedTab.scopeKey) ?? new Map();
    byTabId.set(mountedTab.tab.tabId, mountedTab);
    previousByScope.set(mountedTab.scopeKey, byTabId);
  }
  const mountedTabs = scopeKeys
    .flatMap((scopeKey, scopeIndex) =>
      (tabsByScope[scopeIndex] ?? EMPTY_TERMINAL_TABS).map((tab) => {
        const previousMountedTab = previousByScope.get(scopeKey)?.get(tab.tabId);
        return previousMountedTab?.tab === tab ? previousMountedTab : { scopeKey, tab };
      }),
    )
    .toSorted((left, right) => {
      const leftCreatedAt = left.tab.summary?.createdAt ?? `~${left.tab.tabId}`;
      const rightCreatedAt = right.tab.summary?.createdAt ?? `~${right.tab.tabId}`;
      return leftCreatedAt.localeCompare(rightCreatedAt);
    });

  return { mountedTabs, scopeKeys, tabsByScope };
};

export const createMountedTerminalTabsSelector = () => {
  let snapshot: MountedTerminalTabsSnapshot | undefined;
  return (
    scopeKeys: readonly string[],
    scopes: Readonly<Record<string, TerminalScopePresentation | undefined>>,
  ): MountedTerminalTab[] => {
    snapshot = reconcileMountedTerminalTabs(snapshot, scopeKeys, scopes);
    return snapshot.mountedTabs;
  };
};

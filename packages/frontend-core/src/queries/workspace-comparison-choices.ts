import type { GitTargetBranch } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

type Owner = { workspaceId: string; sessionId: string };

const stores = new WeakMap<QueryClient, WorkspaceComparisonChoices>();

export function useWorkspaceComparisonChoice(owner: Owner) {
  const store = workspaceComparisonChoices(useQueryClient());
  const target = useSyncExternalStore(
    store.subscribe,
    () => store.get(owner),
    () => store.get(owner),
  );
  return {
    target,
    applyTarget: async (choice: GitTargetBranch) => {
      if (choice.branch === "@{upstream}") store.clear(owner);
      else store.set(owner, choice);
    },
  };
}

/** QueryClient gives each app its own memory store. Query does not cache these choices. */
export function workspaceComparisonChoices(client: QueryClient): WorkspaceComparisonChoices {
  let store = stores.get(client);
  if (!store) {
    store = new WorkspaceComparisonChoices();
    stores.set(client, store);
  }
  return store;
}

export class WorkspaceComparisonChoices {
  private choices = new Map<string, GitTargetBranch>();
  private listeners = new Set<() => void>();
  get(owner: Owner): GitTargetBranch | undefined {
    return this.choices.get(this.key(owner));
  }
  set(owner: Owner, target: GitTargetBranch): void {
    this.choices.set(this.key(owner), target);
    for (const listener of this.listeners) listener();
  }
  clear(owner: Owner): void {
    if (!this.choices.delete(this.key(owner))) return;
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private key(owner: Owner): string {
    return JSON.stringify([owner.workspaceId, owner.sessionId]);
  }
}

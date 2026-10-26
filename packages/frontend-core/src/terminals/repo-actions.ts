import type { RepoAction, RepoActions } from "@openducktor/contracts";

export const MISSING_DEFAULT_ACTION_MESSAGE =
  "The default action no longer exists. Choose a default action in the repository actions.";

/** The repository actions that a client offers: the default action first, then the others. */
export type SplitRepoActions =
  | { kind: "empty" }
  // Saved settings always name an existing default action. This state shows a broken config
  // instead of a run control that cannot work.
  | { kind: "missing_default" }
  | { kind: "ready"; defaultAction: RepoAction; otherActions: RepoAction[] };

export const splitRepoActions = ({ items, defaultActionId }: RepoActions): SplitRepoActions => {
  if (items.length === 0) return { kind: "empty" };
  const defaultAction = items.find((action) => action.id === defaultActionId);
  if (!defaultAction) return { kind: "missing_default" };
  return {
    kind: "ready",
    defaultAction,
    otherActions: items.filter((action) => action.id !== defaultAction.id),
  };
};

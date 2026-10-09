import { type RepoAction, type RepoActions, repoActionCommandLines } from "@openducktor/contracts";

/** The action fields that the user edits. The draft keeps the id. */
export type RepoActionFields = Omit<RepoAction, "id">;

export type RepoActionFieldErrors = {
  name?: string;
  command?: string;
};

export const NEW_REPO_ACTION_FIELDS: RepoActionFields = {
  icon: "play",
  name: "",
  command: "",
  runOnWorktreeCreate: false,
  waitBeforeAgentStart: false,
};

export const validateRepoActionFields = (fields: RepoActionFields): RepoActionFieldErrors => {
  const errors: RepoActionFieldErrors = {};
  if (!fields.name.trim()) {
    errors.name = "Enter an action name.";
  }
  if (!fields.command.trim()) {
    errors.command = "Enter a command.";
  } else if (repoActionCommandLines(fields.command).length === 0) {
    errors.command = "Add a command line. Lines that start with # are comments.";
  }
  return errors;
};

export const createRepoAction = (fields: RepoActionFields): RepoAction => ({
  ...fields,
  id: crypto.randomUUID(),
});

/** The first action that the user adds becomes the default action. */
export const addRepoAction = (actions: RepoActions, action: RepoAction): RepoActions => ({
  items: [...actions.items, action],
  defaultActionId: actions.defaultActionId ?? action.id,
});

export const updateRepoAction = (
  actions: RepoActions,
  actionId: string,
  fields: RepoActionFields,
): RepoActions => ({
  ...actions,
  items: actions.items.map((item) => (item.id === actionId ? { ...fields, id: actionId } : item)),
});

/** When the user deletes the default action, the first remaining action becomes the default. */
export const deleteRepoAction = (actions: RepoActions, actionId: string): RepoActions => {
  const items = actions.items.filter((item) => item.id !== actionId);
  const isDefaultDeleted = actions.defaultActionId === actionId;
  return {
    items,
    defaultActionId: isDefaultDeleted ? (items[0]?.id ?? null) : actions.defaultActionId,
  };
};

export const moveRepoAction = (
  actions: RepoActions,
  actionId: string,
  direction: "up" | "down",
): RepoActions => {
  const index = actions.items.findIndex((item) => item.id === actionId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const item = actions.items[index];
  const target = actions.items[targetIndex];
  if (!item || !target) {
    return actions;
  }
  const items = [...actions.items];
  items[index] = target;
  items[targetIndex] = item;
  return { ...actions, items };
};

export const setDefaultRepoAction = (actions: RepoActions, actionId: string): RepoActions => ({
  ...actions,
  defaultActionId: actionId,
});

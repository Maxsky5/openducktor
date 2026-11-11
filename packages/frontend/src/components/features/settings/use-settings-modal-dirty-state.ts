import { type JsonValue, jsonValuesEqual, type SettingsSnapshot } from "@openducktor/contracts";

export type DirtySections = {
  customAgentRoles: boolean;
  general: boolean;
  appearance: boolean;
  chat: boolean;
  notifications: boolean;
  reusablePrompts: boolean;
  globalGit: boolean;
  agentRuntimes?: boolean;
  kanban: boolean;
  autopilot: boolean;
  globalPrompts: boolean;
  repoSettings: boolean;
};

export const EMPTY_DIRTY_SECTIONS: DirtySections = {
  customAgentRoles: false,
  general: false,
  appearance: false,
  chat: false,
  notifications: false,
  reusablePrompts: false,
  globalGit: false,
  agentRuntimes: false,
  kanban: false,
  autopilot: false,
  globalPrompts: false,
  repoSettings: false,
};

type UseSettingsModalDirtyStateArgs = {
  open: boolean;
  baseline: SettingsSnapshot | null;
  draft: SettingsSnapshot | null;
};

/** Dirty sections follow field values, including the baseline of a partial save. */
export const useSettingsModalDirtyState = ({
  open,
  baseline,
  draft,
}: UseSettingsModalDirtyStateArgs) => {
  const dirtySections: DirtySections =
    !open || !baseline || !draft
      ? EMPTY_DIRTY_SECTIONS
      : {
          customAgentRoles: different(baseline.customAgentRoles, draft.customAgentRoles),
          general: different(baseline.general, draft.general),
          appearance:
            different(baseline.appearance, draft.appearance) ||
            different(baseline.system, draft.system),
          chat: different(baseline.chat, draft.chat),
          notifications: different(baseline.notifications, draft.notifications),
          reusablePrompts: different(baseline.reusablePrompts, draft.reusablePrompts),
          globalGit: different(baseline.git, draft.git),
          agentRuntimes: different(baseline.agentRuntimes, draft.agentRuntimes),
          kanban: different(baseline.kanban, draft.kanban),
          autopilot: different(baseline.autopilot, draft.autopilot),
          globalPrompts:
            different(baseline.globalPromptOverrides, draft.globalPromptOverrides) ||
            different(baseline.globalPromptAppends, draft.globalPromptAppends),
          repoSettings: different(baseline.workspaces, draft.workspaces),
        };
  return { dirtySections };
};

const different = (left: JsonValue, right: JsonValue): boolean => !jsonValuesEqual(left, right);

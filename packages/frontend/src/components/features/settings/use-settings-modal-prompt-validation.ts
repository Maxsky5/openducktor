import {
  useWorkflowPromptSettings,
  type WorkflowPromptSettings,
} from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { globalPromptLayersOf, repoPromptLayersOf } from "@openducktor/workflows";
import { useMemo } from "react";
import {
  REPOSITORY_PROMPTS_TITLE,
  type SettingsSectionId,
  SYSTEM_PROMPTS_TITLE,
} from "./settings-modal-constants";
import {
  EMPTY_PROMPT_VALIDATION_STATE,
  type PromptValidationState,
} from "./settings-modal-controller.types";
import {
  buildPromptLayerValidationErrors,
  type PromptValidationErrors,
} from "./settings-prompt-layers";

type UseSettingsModalPromptValidationArgs = {
  snapshotDraft: SettingsSnapshot | null;
  selectedWorkspaceId: string | null;
};

type SettingsModalPromptValidation = {
  promptValidationState: PromptValidationState;
  hasPromptValidationErrors: boolean;
  selectedRepoPromptValidationErrors: PromptValidationErrors;
  selectedRepoPromptValidationErrorCount: number;
  settingsSectionErrorCountById: Record<SettingsSectionId, number>;
};

const EMPTY_ERRORS: PromptValidationErrors = {};

type RepoSettings = SettingsSnapshot["workspaces"][string];
type Templates = WorkflowPromptSettings["templates"];
const repoErrorsCache = new WeakMap<Templates, WeakMap<RepoSettings, PromptValidationErrors>>();

/**
 * The errors of the prompt layers of one repository. A draft edit replaces only the configuration
 * that it changes, so the other repositories keep their errors instead of a new check on each
 * keystroke.
 */
const repoPromptErrors = (repo: RepoSettings, templates: Templates): PromptValidationErrors => {
  let byRepo = repoErrorsCache.get(templates);
  if (!byRepo) {
    byRepo = new WeakMap();
    repoErrorsCache.set(templates, byRepo);
  }
  let errors = byRepo.get(repo);
  if (!errors) {
    errors = buildPromptLayerValidationErrors(repoPromptLayersOf(repo), templates);
    byRepo.set(repo, errors);
  }
  return errors;
};

/** Counts prompts with an error. A prompt counts once for all its layers. */
export const useSettingsModalPromptValidation = ({
  snapshotDraft,
  selectedWorkspaceId,
}: UseSettingsModalPromptValidationArgs): SettingsModalPromptValidation => {
  const prompts = useWorkflowPromptSettings();
  const promptValidationState = useMemo<PromptValidationState>(() => {
    if (!snapshotDraft || !prompts.data) {
      return EMPTY_PROMPT_VALIDATION_STATE;
    }

    const globalErrors = buildPromptLayerValidationErrors(
      globalPromptLayersOf(snapshotDraft),
      prompts.data.templates,
    );
    const globalErrorCount = Object.keys(globalErrors).length;
    let repoTotalErrorCount = 0;

    const repoErrorsByWorkspaceId: Record<string, PromptValidationErrors> = {};
    const repoErrorCountByWorkspaceId: Record<string, number> = {};
    for (const [workspaceId, repoConfig] of Object.entries(snapshotDraft.workspaces)) {
      const repoErrors = repoPromptErrors(repoConfig, prompts.data.templates);
      const repoErrorCount = Object.keys(repoErrors).length;
      if (repoErrorCount === 0) {
        continue;
      }
      repoErrorsByWorkspaceId[workspaceId] = repoErrors;
      repoErrorCountByWorkspaceId[workspaceId] = repoErrorCount;
      repoTotalErrorCount += repoErrorCount;
    }

    const placeOf = (errors: PromptValidationErrors, screen: string): string | null => {
      const [key] = Object.keys(errors);
      const template = prompts.data.templates.find((entry) => entry.key === key);
      if (!template) return null;
      return template.ownerKind === "workflow"
        ? `${template.label} (${template.ownerTitle}, ${screen})`
        : `${template.label} (${screen})`;
    };
    // The open repository comes first, so the place matches the screen that the user sees.
    const repoIds = Object.keys(repoErrorsByWorkspaceId).toSorted(
      (left, right) => Number(right === selectedWorkspaceId) - Number(left === selectedWorkspaceId),
    );
    const firstErrorPlace =
      placeOf(globalErrors, SYSTEM_PROMPTS_TITLE) ??
      repoIds
        .map((id) =>
          placeOf(
            repoErrorsByWorkspaceId[id] ?? {},
            `${REPOSITORY_PROMPTS_TITLE} of ${snapshotDraft.workspaces[id]?.workspaceName ?? id}`,
          ),
        )
        .find((place) => place !== null) ??
      null;

    return {
      firstErrorPlace,
      globalErrors,
      globalErrorCount,
      repoErrorsByWorkspaceId,
      repoErrorCountByWorkspaceId,
      repoTotalErrorCount,
      totalErrorCount: globalErrorCount + repoTotalErrorCount,
    };
  }, [snapshotDraft, prompts.data, selectedWorkspaceId]);

  const selectedRepoPromptValidationErrors =
    (selectedWorkspaceId
      ? promptValidationState.repoErrorsByWorkspaceId[selectedWorkspaceId]
      : undefined) ?? EMPTY_ERRORS;
  const selectedRepoPromptValidationErrorCount = selectedWorkspaceId
    ? (promptValidationState.repoErrorCountByWorkspaceId[selectedWorkspaceId] ?? 0)
    : 0;

  const settingsSectionErrorCountById = {
    general: 0,
    "remote-access": 0,
    git: 0,
    runtimes: 0,
    repositories: promptValidationState.repoTotalErrorCount,
    prompts: promptValidationState.globalErrorCount,
    "reusable-prompts": 0,
    "custom-agent-roles": 0,
    appearance: 0,
    chat: 0,
    notifications: 0,
    kanban: 0,
    autopilot: 0,
  } satisfies Record<SettingsSectionId, number>;

  return {
    promptValidationState,
    hasPromptValidationErrors: promptValidationState.totalErrorCount > 0,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    settingsSectionErrorCountById,
  };
};

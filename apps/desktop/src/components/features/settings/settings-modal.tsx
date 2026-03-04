import type {
  AgentPromptTemplateId,
  GitBranch,
  RepoConfig,
  RepoPromptOverrides,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { listBuiltinAgentPromptTemplates } from "@openducktor/core";
import {
  ChevronDown,
  CircleAlert,
  FolderGit2,
  FolderOpen,
  MessageSquareText,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { RepositorySelector } from "@/components/features/repository/repository-selector";
import {
  buildPromptOverrideValidationErrors,
  canResetPromptOverrideToBuiltin,
  DEFAULT_BRANCH_PREFIX,
  ensureAgentDefault,
  findCatalogModel,
  parseHookLines,
  ROLE_DEFAULTS,
  resetPromptOverrideToBuiltin,
  selectedModelKeyForRole,
  toRoleVariantOptions,
} from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ComboboxOption } from "@/components/ui/combobox";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { pickRepositoryDirectory } from "@/lib/repo-directory";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { cn } from "@/lib/utils";
import { REPO_SETTINGS_UPDATED_EVENT } from "@/pages/agents/use-agent-studio-repo-settings";
import { useWorkspaceState } from "@/state";
import { loadRepoBranches, loadRepoOpencodeCatalog } from "@/state/operations";

type SettingsModalProps = {
  triggerClassName?: string;
  triggerSize?: "default" | "sm" | "lg" | "icon";
};

type SettingsSectionId = "general" | "repositories" | "prompts";
type RepositorySectionId = "configuration" | "agents" | "prompts";
type PromptRoleTabId = "shared" | "spec" | "planner" | "build" | "qa";

type BuiltinPromptDefinition = ReturnType<typeof listBuiltinAgentPromptTemplates>[number];

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: typeof SlidersHorizontal;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
  { id: "prompts", label: "Prompts", icon: MessageSquareText },
];

const REPOSITORY_SECTIONS: ReadonlyArray<{
  id: RepositorySectionId;
  label: string;
}> = [
  { id: "configuration", label: "Configuration" },
  { id: "agents", label: "Agents" },
  { id: "prompts", label: "Repo Prompts" },
];

const PROMPT_ROLE_TABS: ReadonlyArray<{
  id: PromptRoleTabId;
  label: string;
}> = [
  { id: "shared", label: "Shared" },
  { id: "spec", label: "Spec" },
  { id: "planner", label: "Planner" },
  { id: "build", label: "Builder" },
  { id: "qa", label: "QA" },
];

const PROMPT_TEMPLATE_LABELS: Record<AgentPromptTemplateId, string> = {
  "system.shared.workflow_guards": "Workflow Guards",
  "system.shared.tool_protocol": "Tool Protocol",
  "system.shared.task_context": "Task Context",
  "system.role.spec.base": "Spec Role Base",
  "system.role.planner.base": "Planner Role Base",
  "system.role.build.base": "Builder Role Base",
  "system.role.qa.base": "QA Role Base",
  "system.scenario.spec_initial": "Spec Scenario",
  "system.scenario.planner_initial": "Planner Scenario",
  "system.scenario.build_implementation_start": "Builder Start Scenario",
  "system.scenario.build_after_qa_rejected": "Builder After QA Rejection",
  "system.scenario.build_after_human_request_changes": "Builder After Human Changes",
  "system.scenario.qa_review": "QA Review Scenario",
  "kickoff.spec_initial": "Spec Kickoff",
  "kickoff.planner_initial": "Planner Kickoff",
  "kickoff.build_implementation_start": "Builder Kickoff",
  "kickoff.build_after_qa_rejected": "Builder Kickoff After QA Rejection",
  "kickoff.build_after_human_request_changes": "Builder Kickoff After Human Changes",
  "kickoff.qa_review": "QA Kickoff",
  "permission.read_only.reject": "Read-Only Permission Rejection",
};

const PROMPT_TEMPLATE_DESCRIPTIONS: Record<AgentPromptTemplateId, string> = {
  "system.shared.workflow_guards":
    "Added to every system prompt to enforce global workflow guardrails and operating rules.",
  "system.shared.tool_protocol":
    "Added to every system prompt to define the required tool-calling protocol and response handling.",
  "system.shared.task_context":
    "Added to every system prompt to inject task/repository context and execution constraints.",
  "system.role.spec.base":
    "Base system instructions used for every Spec agent run, before scenario-specific additions.",
  "system.role.planner.base":
    "Base system instructions used for every Planner agent run, before scenario-specific additions.",
  "system.role.build.base":
    "Base system instructions used for every Builder agent run, before scenario-specific additions.",
  "system.role.qa.base":
    "Base system instructions used for every QA agent run, before scenario-specific additions.",
  "system.scenario.spec_initial":
    "Scenario-specific system instructions appended when starting an initial specification pass.",
  "system.scenario.planner_initial":
    "Scenario-specific system instructions appended when starting an initial planning pass.",
  "system.scenario.build_implementation_start":
    "Scenario-specific system instructions appended when Builder starts implementation from plan.",
  "system.scenario.build_after_qa_rejected":
    "Scenario-specific system instructions appended when Builder resumes after a QA rejection.",
  "system.scenario.build_after_human_request_changes":
    "Scenario-specific system instructions appended when Builder resumes after human-requested changes.",
  "system.scenario.qa_review":
    "Scenario-specific system instructions appended when QA starts reviewing an implementation.",
  "kickoff.spec_initial": "Initial kickoff message sent when a Spec session is created.",
  "kickoff.planner_initial": "Initial kickoff message sent when a Planner session is created.",
  "kickoff.build_implementation_start":
    "Initial kickoff message sent when Builder starts implementation.",
  "kickoff.build_after_qa_rejected":
    "Initial kickoff message sent when Builder restarts after QA rejection.",
  "kickoff.build_after_human_request_changes":
    "Initial kickoff message sent when Builder restarts after human-requested changes.",
  "kickoff.qa_review": "Initial kickoff message sent when a QA review session is created.",
  "permission.read_only.reject":
    "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
};

const BUILTIN_PROMPTS_BY_ID: Record<AgentPromptTemplateId, BuiltinPromptDefinition> = (() => {
  const map = {} as Record<AgentPromptTemplateId, BuiltinPromptDefinition>;
  for (const definition of listBuiltinAgentPromptTemplates()) {
    map[definition.id] = definition;
  }
  return map;
})();

const resolvePromptRoleTab = (templateId: AgentPromptTemplateId): PromptRoleTabId => {
  if (templateId.includes(".spec.") || templateId.includes("spec_")) {
    return "spec";
  }
  if (templateId.includes(".planner.") || templateId.includes("planner_")) {
    return "planner";
  }
  if (templateId.includes(".build.") || templateId.includes("build_")) {
    return "build";
  }
  if (templateId.includes(".qa.") || templateId.includes("qa_")) {
    return "qa";
  }
  return "shared";
};

const PROMPT_IDS_BY_ROLE: Record<PromptRoleTabId, AgentPromptTemplateId[]> = {
  shared: [],
  spec: [],
  planner: [],
  build: [],
  qa: [],
};

for (const templateId of agentPromptTemplateIdValues) {
  PROMPT_IDS_BY_ROLE[resolvePromptRoleTab(templateId)].push(templateId);
}

const countPromptErrorsByRoleTab = (
  errors: Partial<Record<AgentPromptTemplateId, string>>,
): Record<PromptRoleTabId, number> => {
  const counts: Record<PromptRoleTabId, number> = {
    shared: 0,
    spec: 0,
    planner: 0,
    build: 0,
    qa: 0,
  };

  for (const templateId of agentPromptTemplateIdValues) {
    if (!errors[templateId]) {
      continue;
    }
    counts[resolvePromptRoleTab(templateId)] += 1;
  }

  return counts;
};

const trimNonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizePromptOverridesForSave = (overrides: RepoPromptOverrides): RepoPromptOverrides => {
  const next: RepoPromptOverrides = {};

  for (const templateId of agentPromptTemplateIdValues) {
    const entry = overrides[templateId];
    if (!entry) {
      continue;
    }

    const template = trimNonEmpty(entry.template);
    if (!template) {
      continue;
    }

    next[templateId] = {
      template,
      baseVersion: Math.max(1, Math.trunc(entry.baseVersion || 1)),
      enabled: entry.enabled !== false,
    };
  }

  return next;
};

const normalizeAgentDefaultForSave = (
  entry:
    | {
        providerId: string;
        modelId: string;
        variant?: string | undefined;
        opencodeAgent?: string | undefined;
      }
    | undefined,
) => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimNonEmpty(entry.providerId);
  const modelId = trimNonEmpty(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  const variant = trimNonEmpty(entry.variant ?? "");
  const opencodeAgent = trimNonEmpty(entry.opencodeAgent ?? "");

  return {
    providerId,
    modelId,
    ...(variant ? { variant } : {}),
    ...(opencodeAgent ? { opencodeAgent } : {}),
  };
};

const normalizeRepoConfigForSave = (repo: RepoConfig): RepoConfig => {
  const spec = normalizeAgentDefaultForSave(repo.agentDefaults.spec);
  const planner = normalizeAgentDefaultForSave(repo.agentDefaults.planner);
  const build = normalizeAgentDefaultForSave(repo.agentDefaults.build);
  const qa = normalizeAgentDefaultForSave(repo.agentDefaults.qa);

  return {
    worktreeBasePath: trimNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeCanonicalTargetBranch(repo.defaultTargetBranch),
    trustedHooks: repo.trustedHooks,
    trustedHooksFingerprint: repo.trustedHooksFingerprint,
    hooks: {
      preStart: repo.hooks.preStart.map((entry) => entry.trim()).filter(Boolean),
      postComplete: repo.hooks.postComplete.map((entry) => entry.trim()).filter(Boolean),
    },
    worktreeFileCopies: repo.worktreeFileCopies.map((entry) => entry.trim()).filter(Boolean),
    promptOverrides: normalizePromptOverridesForSave(repo.promptOverrides),
    agentDefaults: {
      ...(spec ? { spec } : {}),
      ...(planner ? { planner } : {}),
      ...(build ? { build } : {}),
      ...(qa ? { qa } : {}),
    },
  };
};

const normalizeSnapshotForSave = (snapshot: SettingsSnapshot): SettingsSnapshot => {
  const repos = Object.fromEntries(
    Object.entries(snapshot.repos).map(([repoPath, repoConfig]) => [
      repoPath,
      normalizeRepoConfigForSave(repoConfig),
    ]),
  );

  return {
    repos,
    globalPromptOverrides: normalizePromptOverridesForSave(snapshot.globalPromptOverrides),
  };
};

const pickInitialRepoPath = (
  snapshot: SettingsSnapshot,
  activeRepo: string | null,
): string | null => {
  const repoPaths = Object.keys(snapshot.repos).sort();
  if (activeRepo && snapshot.repos[activeRepo]) {
    return activeRepo;
  }
  return repoPaths[0] ?? null;
};

type PromptOverrideCardProps = {
  label: string;
  description: string;
  override?: RepoPromptOverrides[AgentPromptTemplateId] | undefined;
  inheritedPreview?:
    | {
        sourceLabel: string;
        template: string;
      }
    | undefined;
  disabled: boolean;
  canResetToBuiltin: boolean;
  validationError?: string | undefined;
  onToggleEnabled: (next: boolean) => void;
  onTemplateChange: (nextTemplate: string) => void;
  onResetToBuiltin: () => void;
};

function PromptOverrideCard({
  label,
  description,
  override,
  inheritedPreview,
  disabled,
  canResetToBuiltin,
  validationError,
  onToggleEnabled,
  onTemplateChange,
  onResetToBuiltin,
}: PromptOverrideCardProps): ReactElement {
  const isOverrideEnabled = Boolean(override && override.enabled !== false);
  const editorValue = override?.template ?? inheritedPreview?.template ?? "";
  const [isInheritedPromptExpanded, setIsInheritedPromptExpanded] = useState(false);

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold text-foreground">{label}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Label className="flex shrink-0 items-center gap-2 text-xs text-foreground sm:justify-self-end">
          <Switch
            checked={isOverrideEnabled}
            onCheckedChange={onToggleEnabled}
            disabled={disabled}
          />
          Enable override
        </Label>
      </div>

      {inheritedPreview ? (
        <Collapsible
          open={isInheritedPromptExpanded}
          onOpenChange={setIsInheritedPromptExpanded}
          className="rounded-md border border-border bg-muted/60"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/80"
            >
              <p className="text-xs font-medium text-foreground">
                Inherited prompt in use: {inheritedPreview.sourceLabel}
              </p>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  isInheritedPromptExpanded ? "rotate-180" : "rotate-0",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent forceMount className="overflow-hidden data-[state=closed]:hidden">
            <div className="border-t border-border px-3 pb-3 pt-2">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-input bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground">
                {inheritedPreview.template}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <div className="grid gap-2">
        <Label className="text-xs text-foreground">Override prompt</Label>
        <Textarea
          value={editorValue}
          rows={7}
          className="font-mono text-xs"
          disabled={disabled}
          onChange={(event) => onTemplateChange(event.currentTarget.value)}
        />
        {validationError ? (
          <p className="text-xs text-destructive-muted">{validationError}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !canResetToBuiltin}
          onClick={onResetToBuiltin}
        >
          Reset to Builtin
        </Button>
      </div>
    </div>
  );
}

export function SettingsModal({
  triggerClassName,
  triggerSize = "sm",
}: SettingsModalProps): ReactElement {
  const { activeRepo, loadSettingsSnapshot, saveSettingsSnapshot } = useWorkspaceState();

  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("repositories");
  const [repositorySection, setRepositorySection] = useState<RepositorySectionId>("configuration");
  const [globalPromptRoleTab, setGlobalPromptRoleTab] = useState<PromptRoleTabId>("shared");
  const [repoPromptRoleTab, setRepoPromptRoleTab] = useState<PromptRoleTabId>("shared");
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);

  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPickingWorktreeBasePath, setIsPickingWorktreeBasePath] = useState(false);

  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(null);
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null);
  const [repoBranchesByPath, setRepoBranchesByPath] = useState<Record<string, GitBranch[]>>({});
  const [isLoadingRepoBranchesByPath, setIsLoadingRepoBranchesByPath] = useState<
    Record<string, boolean>
  >({});
  const [repoBranchesErrorByPath, setRepoBranchesErrorByPath] = useState<
    Record<string, string | undefined>
  >({});

  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const repoPaths = useMemo(() => {
    if (!snapshotDraft) {
      return [];
    }
    return Object.keys(snapshotDraft.repos).sort();
  }, [snapshotDraft]);

  const selectedRepoConfig = useMemo(() => {
    if (!snapshotDraft || !selectedRepoPath) {
      return null;
    }
    return snapshotDraft.repos[selectedRepoPath] ?? null;
  }, [selectedRepoPath, snapshotDraft]);

  const selectedRepoBranches = useMemo(
    () => (selectedRepoPath ? (repoBranchesByPath[selectedRepoPath] ?? []) : []),
    [repoBranchesByPath, selectedRepoPath],
  );
  const isLoadingSelectedRepoBranches = selectedRepoPath
    ? Boolean(isLoadingRepoBranchesByPath[selectedRepoPath])
    : false;
  const selectedRepoBranchesError = selectedRepoPath
    ? (repoBranchesErrorByPath[selectedRepoPath] ?? null)
    : null;

  const promptValidationState = useMemo(() => {
    if (!snapshotDraft) {
      return {
        globalErrors: {},
        globalErrorCount: 0,
        repoErrorsByPath: {},
        repoErrorCountByPath: {},
        repoTotalErrorCount: 0,
        totalErrorCount: 0,
      };
    }

    const globalErrors = buildPromptOverrideValidationErrors(snapshotDraft.globalPromptOverrides);
    const globalErrorCount = Object.keys(globalErrors).length;
    let repoTotalErrorCount = 0;
    let totalErrorCount = globalErrorCount;

    const repoErrorsByPath: Record<
      string,
      ReturnType<typeof buildPromptOverrideValidationErrors>
    > = {};
    const repoErrorCountByPath: Record<string, number> = {};
    for (const [repoPath, repoConfig] of Object.entries(snapshotDraft.repos)) {
      const repoErrors = buildPromptOverrideValidationErrors(repoConfig.promptOverrides);
      const repoErrorCount = Object.keys(repoErrors).length;
      if (repoErrorCount === 0) {
        continue;
      }
      repoErrorsByPath[repoPath] = repoErrors;
      repoErrorCountByPath[repoPath] = repoErrorCount;
      repoTotalErrorCount += repoErrorCount;
      totalErrorCount += repoErrorCount;
    }

    return {
      globalErrors,
      globalErrorCount,
      repoErrorsByPath,
      repoErrorCountByPath,
      repoTotalErrorCount,
      totalErrorCount,
    };
  }, [snapshotDraft]);

  const selectedRepoPromptValidationErrors = useMemo(
    () =>
      (selectedRepoPath ? promptValidationState.repoErrorsByPath[selectedRepoPath] : undefined) ??
      {},
    [promptValidationState.repoErrorsByPath, selectedRepoPath],
  );

  const hasPromptValidationErrors = promptValidationState.totalErrorCount > 0;

  const globalPromptRoleTabErrorCounts = useMemo(
    () => countPromptErrorsByRoleTab(promptValidationState.globalErrors),
    [promptValidationState.globalErrors],
  );

  const selectedRepoPromptRoleTabErrorCounts = useMemo(
    () => countPromptErrorsByRoleTab(selectedRepoPromptValidationErrors),
    [selectedRepoPromptValidationErrors],
  );

  const selectedRepoPromptValidationErrorCount = selectedRepoPath
    ? (promptValidationState.repoErrorCountByPath[selectedRepoPath] ?? 0)
    : 0;

  const settingsSectionErrorCountById: Record<SettingsSectionId, number> = {
    general: 0,
    repositories: promptValidationState.repoTotalErrorCount,
    prompts: promptValidationState.globalErrorCount,
  };

  const modelOptions = useMemo<ComboboxOption[]>(() => toModelOptions(catalog), [catalog]);
  const agentOptions = useMemo<ComboboxOption[]>(() => toPrimaryAgentOptions(catalog), [catalog]);
  const modelGroups = useMemo(() => toModelGroupsByProvider(catalog), [catalog]);

  useEffect(() => {
    if (!open) {
      setSaveError(null);
      setSettingsError(null);
      setRepoBranchesByPath({});
      setIsLoadingRepoBranchesByPath({});
      setRepoBranchesErrorByPath({});
      return;
    }

    let cancelled = false;
    setIsLoadingSettings(true);
    setSettingsError(null);
    setSaveError(null);

    void loadSettingsSnapshot()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        setSnapshotDraft(snapshot);
        setSelectedRepoPath(pickInitialRepoPath(snapshot, activeRepo));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setSnapshotDraft(null);
        setSelectedRepoPath(null);
        setSettingsError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, loadSettingsSnapshot, open]);

  useEffect(() => {
    if (!snapshotDraft) {
      return;
    }

    if (selectedRepoPath && snapshotDraft.repos[selectedRepoPath]) {
      return;
    }

    const fallbackRepo = pickInitialRepoPath(snapshotDraft, activeRepo);
    if (fallbackRepo !== selectedRepoPath) {
      setSelectedRepoPath(fallbackRepo);
    }
  }, [activeRepo, selectedRepoPath, snapshotDraft]);

  useEffect(() => {
    if (!open || !selectedRepoPath) {
      setCatalog(null);
      setCatalogError(null);
      setIsLoadingCatalog(false);
      return;
    }

    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);
    setIsLoadingCatalog(true);

    void loadRepoOpencodeCatalog(selectedRepoPath)
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog(null);
          setCatalogError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedRepoPath]);

  useEffect(() => {
    if (!open || !selectedRepoPath) {
      return;
    }

    if (
      repoBranchesByPath[selectedRepoPath] ||
      isLoadingRepoBranchesByPath[selectedRepoPath] ||
      repoBranchesErrorByPath[selectedRepoPath]
    ) {
      return;
    }

    setIsLoadingRepoBranchesByPath((current) => ({ ...current, [selectedRepoPath]: true }));

    void loadRepoBranches(selectedRepoPath)
      .then((branches) => {
        setRepoBranchesByPath((current) => ({ ...current, [selectedRepoPath]: branches }));
        setRepoBranchesErrorByPath((current) => ({ ...current, [selectedRepoPath]: undefined }));
      })
      .catch((error: unknown) => {
        setRepoBranchesErrorByPath((current) => ({
          ...current,
          [selectedRepoPath]: errorMessage(error),
        }));
      })
      .finally(() => {
        setIsLoadingRepoBranchesByPath((current) => ({ ...current, [selectedRepoPath]: false }));
      });
  }, [
    isLoadingRepoBranchesByPath,
    open,
    repoBranchesByPath,
    repoBranchesErrorByPath,
    selectedRepoPath,
  ]);

  const retrySelectedRepoBranchesLoad = useCallback((): void => {
    if (!selectedRepoPath) {
      return;
    }

    setRepoBranchesErrorByPath((current) => ({ ...current, [selectedRepoPath]: undefined }));
    setRepoBranchesByPath((current) => {
      const { [selectedRepoPath]: _ignored, ...remaining } = current;
      return remaining;
    });
  }, [selectedRepoPath]);

  const updateSelectedRepoConfig = useCallback(
    (updater: (current: RepoConfig) => RepoConfig): void => {
      setSnapshotDraft((current) => {
        if (!current || !selectedRepoPath) {
          return current;
        }

        const existingRepo = current.repos[selectedRepoPath];
        if (!existingRepo) {
          return current;
        }

        return {
          ...current,
          repos: {
            ...current.repos,
            [selectedRepoPath]: updater(existingRepo),
          },
        };
      });
    },
    [selectedRepoPath],
  );

  const updateGlobalPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          globalPromptOverrides: updater(current.globalPromptOverrides),
        };
      });
    },
    [],
  );

  const updateRepoPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        promptOverrides: updater(repoConfig.promptOverrides),
      }));
    },
    [updateSelectedRepoConfig],
  );

  const updateSelectedRepoAgentDefault = useCallback(
    (
      role: "spec" | "planner" | "build" | "qa",
      field: "providerId" | "modelId" | "variant" | "opencodeAgent",
      value: string,
    ): void => {
      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        agentDefaults: {
          ...repoConfig.agentDefaults,
          [role]: {
            ...ensureAgentDefault(repoConfig.agentDefaults[role]),
            [field]: value,
          },
        },
      }));
    },
    [updateSelectedRepoConfig],
  );

  const clearSelectedRepoAgentDefault = useCallback(
    (role: "spec" | "planner" | "build" | "qa"): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const { [role]: _ignored, ...remainingDefaults } = repoConfig.agentDefaults;
        return {
          ...repoConfig,
          agentDefaults: remainingDefaults,
        };
      });
    },
    [updateSelectedRepoConfig],
  );

  const pickWorktreeBasePath = useCallback(async (): Promise<void> => {
    setIsPickingWorktreeBasePath(true);

    try {
      const selectedDirectory = await pickRepositoryDirectory();
      if (!selectedDirectory) {
        return;
      }

      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        worktreeBasePath: selectedDirectory,
      }));
    } catch (error: unknown) {
      toast.error("Failed to pick worktree base path", {
        description: errorMessage(error),
      });
    } finally {
      setIsPickingWorktreeBasePath(false);
    }
  }, [updateSelectedRepoConfig]);

  const submit = async (): Promise<void> => {
    if (!snapshotDraft) {
      return;
    }

    if (hasPromptValidationErrors) {
      const suffix = promptValidationState.totalErrorCount > 1 ? "s" : "";
      const reason = `Fix ${promptValidationState.totalErrorCount} prompt placeholder error${suffix} before saving.`;
      setSaveError(reason);
      toast.error("Cannot save settings", {
        description: reason,
      });
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      await saveSettingsSnapshot(normalizeSnapshotForSave(snapshotDraft));

      if (typeof window !== "undefined" && activeRepo) {
        window.dispatchEvent(
          new CustomEvent(REPO_SETTINGS_UPDATED_EVENT, {
            detail: { repoPath: activeRepo },
          }),
        );
      }

      setOpen(false);
    } catch (error: unknown) {
      const reason = errorMessage(error);
      setSaveError(reason);
      toast.error("Failed to save workspace settings", {
        description: reason,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderRepositoryConfiguration = (): ReactElement => {
    if (!selectedRepoConfig) {
      return (
        <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
          Select a repository to edit repository settings.
        </div>
      );
    }

    const defaultTargetBranchValue = normalizeCanonicalTargetBranch(
      selectedRepoConfig.defaultTargetBranch,
    );
    const defaultTargetBranchOptions = toBranchSelectorOptions(selectedRepoBranches, {
      includeBranchNames: [defaultTargetBranchValue],
    });
    const isDefaultTargetBranchPickerDisabled =
      isLoadingSettings ||
      isSaving ||
      isLoadingSelectedRepoBranches ||
      defaultTargetBranchOptions.length === 0;
    const defaultTargetBranchPlaceholder = isLoadingSelectedRepoBranches
      ? "Loading branches..."
      : selectedRepoBranchesError
        ? "Branches unavailable"
        : "Select branch...";

    return (
      <div className="grid gap-4 p-4">
        <div className="grid gap-2">
          <Label htmlFor="repo-worktree-path">Worktree base path</Label>
          <div className="flex items-center gap-2">
            <Input
              id="repo-worktree-path"
              className="flex-1"
              placeholder="/absolute/path/outside/repo"
              value={selectedRepoConfig.worktreeBasePath ?? ""}
              disabled={isLoadingSettings || isSaving || isPickingWorktreeBasePath}
              onChange={(event) => {
                const worktreeBasePath = event.currentTarget.value;
                updateSelectedRepoConfig((repoConfig) => ({
                  ...repoConfig,
                  worktreeBasePath,
                }));
              }}
            />
            <Button
              type="button"
              size="icon"
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isLoadingSettings || isSaving || isPickingWorktreeBasePath}
              onClick={() => void pickWorktreeBasePath()}
              aria-label="Pick worktree base path"
              title="Pick worktree base path"
            >
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="repo-branch-prefix">Branch prefix</Label>
            <Input
              id="repo-branch-prefix"
              value={selectedRepoConfig.branchPrefix}
              disabled={isLoadingSettings || isSaving}
              onChange={(event) => {
                const branchPrefix = event.currentTarget.value;
                updateSelectedRepoConfig((repoConfig) => ({
                  ...repoConfig,
                  branchPrefix,
                }));
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label>Default target branch</Label>
            <BranchSelector
              value={defaultTargetBranchValue}
              options={defaultTargetBranchOptions}
              disabled={isDefaultTargetBranchPickerDisabled}
              placeholder={defaultTargetBranchPlaceholder}
              searchPlaceholder="Search branch..."
              onValueChange={(nextBranch) =>
                updateSelectedRepoConfig((repoConfig) => ({
                  ...repoConfig,
                  defaultTargetBranch: nextBranch,
                }))
              }
            />
            {selectedRepoBranchesError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-warning-muted">
                  Failed to load branches for repository: {selectedRepoBranchesError}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={isLoadingSelectedRepoBranches || isSaving}
                  onClick={retrySelectedRepoBranchesLoad}
                >
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <Label
          htmlFor="repo-trusted-hooks"
          className="flex items-center gap-2 text-sm text-foreground"
        >
          <Switch
            id="repo-trusted-hooks"
            checked={selectedRepoConfig.trustedHooks}
            disabled={isLoadingSettings || isSaving}
            onCheckedChange={(checked) =>
              updateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                trustedHooks: checked,
              }))
            }
          />
          Trust scripts for this repository
        </Label>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="repo-pre-start-hooks">
              Worktree setup script (one command per line)
            </Label>
            <Textarea
              id="repo-pre-start-hooks"
              rows={4}
              value={selectedRepoConfig.hooks.preStart.join("\n")}
              disabled={isLoadingSettings || isSaving}
              onChange={(event) => {
                const preStartHooksInput = event.currentTarget.value;
                updateSelectedRepoConfig((repoConfig) => ({
                  ...repoConfig,
                  hooks: {
                    ...repoConfig.hooks,
                    preStart: parseHookLines(preStartHooksInput),
                  },
                }));
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repo-post-complete-hooks">
              Worktree cleanup script (one command per line)
            </Label>
            <Textarea
              id="repo-post-complete-hooks"
              rows={4}
              value={selectedRepoConfig.hooks.postComplete.join("\n")}
              disabled={isLoadingSettings || isSaving}
              onChange={(event) => {
                const postCompleteHooksInput = event.currentTarget.value;
                updateSelectedRepoConfig((repoConfig) => ({
                  ...repoConfig,
                  hooks: {
                    ...repoConfig.hooks,
                    postComplete: parseHookLines(postCompleteHooksInput),
                  },
                }));
              }}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="repo-worktree-file-copies">
            Worktree file copies (one path per line)
          </Label>
          <Textarea
            id="repo-worktree-file-copies"
            rows={4}
            value={selectedRepoConfig.worktreeFileCopies.join("\n")}
            disabled={isLoadingSettings || isSaving}
            onChange={(event) => {
              const worktreeFileCopiesInput = event.currentTarget.value;
              updateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                worktreeFileCopies: parseHookLines(worktreeFileCopiesInput),
              }));
            }}
          />
        </div>
      </div>
    );
  };

  const renderRepositoryAgents = (): ReactElement => {
    if (!selectedRepoConfig) {
      return (
        <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
          Select a repository to edit agent defaults.
        </div>
      );
    }

    const missingRoleLabels = ROLE_DEFAULTS.filter(({ role }) => {
      const value = selectedRepoConfig.agentDefaults[role];
      return !(
        value &&
        value.providerId.trim().length > 0 &&
        value.modelId.trim().length > 0 &&
        (value.opencodeAgent?.trim().length ?? 0) > 0
      );
    }).map(({ label }) => label);

    return (
      <div className="grid gap-4 p-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Agent Defaults (Per Role)</h3>
          <p className="text-xs text-muted-foreground">
            Defaults are applied when starting sessions in this repository.
          </p>
        </div>

        {isLoadingCatalog ? (
          <p className="text-xs text-muted-foreground">Loading available agents and models...</p>
        ) : null}
        {catalogError ? (
          <p className="text-xs text-warning-muted">
            Failed to load OpenCode catalog: {catalogError}
          </p>
        ) : null}
        {missingRoleLabels.length > 0 ? (
          <p className="text-xs text-warning-muted">
            Missing complete defaults for: {missingRoleLabels.join(", ")}.
          </p>
        ) : null}

        <div className="grid gap-3">
          {ROLE_DEFAULTS.map(({ role, label }) => {
            const value = ensureAgentDefault(selectedRepoConfig.agentDefaults[role] ?? null);
            const roleVariantOptions = toRoleVariantOptions(
              catalog,
              selectedRepoConfig.agentDefaults,
              role,
            );
            const modelKey = selectedModelKeyForRole(selectedRepoConfig.agentDefaults, role);

            return (
              <div key={role} className="grid gap-2 rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isLoadingSettings || isSaving}
                    onClick={() => clearSelectedRepoAgentDefault(role)}
                  >
                    Clear
                  </Button>
                </div>

                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="grid min-w-0 gap-1">
                    <Label className="text-xs">Agent</Label>
                    <Combobox
                      value={value.opencodeAgent}
                      options={agentOptions}
                      placeholder={isLoadingCatalog ? "Loading agents..." : "Select agent"}
                      disabled={isLoadingCatalog || isSaving || agentOptions.length === 0}
                      onValueChange={(opencodeAgent) =>
                        updateSelectedRepoAgentDefault(role, "opencodeAgent", opencodeAgent)
                      }
                    />
                  </div>

                  <div className="grid min-w-0 gap-1">
                    <Label className="text-xs">Model</Label>
                    <Combobox
                      value={modelKey}
                      options={modelOptions}
                      groups={modelGroups}
                      placeholder={isLoadingCatalog ? "Loading models..." : "Select model"}
                      disabled={isLoadingCatalog || isSaving || modelOptions.length === 0}
                      onValueChange={(selectedModelKey) => {
                        const model = findCatalogModel(catalog, selectedModelKey);
                        if (!model) {
                          return;
                        }

                        updateSelectedRepoConfig((repoConfig) => ({
                          ...repoConfig,
                          agentDefaults: {
                            ...repoConfig.agentDefaults,
                            [role]: {
                              ...ensureAgentDefault(repoConfig.agentDefaults[role] ?? null),
                              providerId: model.providerId,
                              modelId: model.modelId,
                              variant: model.variants[0] ?? "",
                            },
                          },
                        }));
                      }}
                    />
                  </div>

                  <div className="grid min-w-0 gap-1">
                    <Label className="text-xs">Variant</Label>
                    <Combobox
                      value={value.variant}
                      options={roleVariantOptions}
                      placeholder={
                        roleVariantOptions.length > 0 ? "Select variant" : "No variants for model"
                      }
                      disabled={
                        isLoadingCatalog || isSaving || !modelKey || roleVariantOptions.length === 0
                      }
                      onValueChange={(variant) =>
                        updateSelectedRepoAgentDefault(role, "variant", variant)
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPromptTabButtons = (
    value: PromptRoleTabId,
    onChange: (next: PromptRoleTabId) => void,
    errorCounts: Record<PromptRoleTabId, number>,
  ): ReactElement => {
    return (
      <div
        className="inline-flex h-9 w-full items-center bg-muted p-1"
        role="tablist"
        aria-label="Prompt role tabs"
      >
        {PROMPT_ROLE_TABS.map((entry) => {
          const tabErrorCount = errorCounts[entry.id];
          const isActive = value === entry.id;

          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                "inline-flex h-7 flex-1 items-center justify-center rounded-sm px-3 text-xs transition-colors cursor-pointer",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
                (isLoadingSettings || isSaving) && "pointer-events-none opacity-50",
              )}
              onClick={() => onChange(entry.id)}
              disabled={isLoadingSettings || isSaving}
              title={
                tabErrorCount > 0
                  ? `${tabErrorCount} prompt placeholder error${tabErrorCount > 1 ? "s" : ""}`
                  : undefined
              }
            >
              <span className="inline-flex items-center gap-1.5">
                <span>{entry.label}</span>
                {tabErrorCount > 0 ? (
                  <CircleAlert
                    className={cn(
                      "size-3.5 shrink-0",
                      isActive ? "text-primary-foreground" : "text-destructive-muted",
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              {tabErrorCount > 0 ? (
                <span className="sr-only">
                  {tabErrorCount} prompt placeholder error{tabErrorCount > 1 ? "s" : ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  };

  const renderGlobalPrompts = (): ReactElement => {
    const promptOverrides = snapshotDraft?.globalPromptOverrides ?? {};
    const promptIds = PROMPT_IDS_BY_ROLE[globalPromptRoleTab];
    const globalPromptValidationErrors = promptValidationState.globalErrors;
    const visibleErrorCount = promptIds.filter((templateId) =>
      Boolean(globalPromptValidationErrors[templateId]),
    ).length;

    return (
      <div className="grid gap-4 p-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Global Prompt Overrides</h3>
          <p className="text-xs text-muted-foreground">
            Global overrides apply to every repository unless a repository-specific enabled override
            exists for the same prompt.
          </p>
        </div>

        {renderPromptTabButtons(
          globalPromptRoleTab,
          setGlobalPromptRoleTab,
          globalPromptRoleTabErrorCounts,
        )}

        {visibleErrorCount > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {visibleErrorCount} prompt placeholder error{visibleErrorCount > 1 ? "s" : ""} in this
            tab.
          </div>
        ) : null}

        <div className="grid gap-3">
          {promptIds.map((templateId) => {
            const builtin = BUILTIN_PROMPTS_BY_ID[templateId];
            const override = promptOverrides[templateId];
            const canResetToBuiltin = canResetPromptOverrideToBuiltin(override, builtin.template);
            const inheritedPreview =
              override && override.enabled !== false
                ? undefined
                : {
                    sourceLabel: "Builtin prompt",
                    template: builtin.template,
                  };

            return (
              <PromptOverrideCard
                key={templateId}
                label={PROMPT_TEMPLATE_LABELS[templateId]}
                description={PROMPT_TEMPLATE_DESCRIPTIONS[templateId]}
                override={override}
                inheritedPreview={inheritedPreview}
                disabled={isLoadingSettings || isSaving}
                canResetToBuiltin={canResetToBuiltin}
                validationError={globalPromptValidationErrors[templateId]}
                onToggleEnabled={(nextEnabled) => {
                  updateGlobalPromptOverrides((currentOverrides) => {
                    const existing = currentOverrides[templateId];
                    if (nextEnabled) {
                      return {
                        ...currentOverrides,
                        [templateId]: {
                          template: existing?.template ?? builtin.template,
                          baseVersion: existing?.baseVersion ?? builtin.builtinVersion,
                          enabled: true,
                        },
                      };
                    }

                    if (!existing) {
                      return currentOverrides;
                    }

                    return {
                      ...currentOverrides,
                      [templateId]: {
                        ...existing,
                        enabled: false,
                      },
                    };
                  });
                }}
                onTemplateChange={(nextTemplate) => {
                  updateGlobalPromptOverrides((currentOverrides) => {
                    const existing = currentOverrides[templateId];
                    return {
                      ...currentOverrides,
                      [templateId]: {
                        template: nextTemplate,
                        baseVersion: existing?.baseVersion ?? builtin.builtinVersion,
                        enabled: existing ? existing.enabled !== false : false,
                      },
                    };
                  });
                }}
                onResetToBuiltin={() => {
                  updateGlobalPromptOverrides((currentOverrides) =>
                    resetPromptOverrideToBuiltin(
                      currentOverrides,
                      templateId,
                      builtin.template,
                      builtin.builtinVersion,
                    ),
                  );
                }}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderRepositoryPrompts = (): ReactElement => {
    if (!selectedRepoConfig || !snapshotDraft) {
      return (
        <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
          Select a repository to configure repository-level prompts.
        </div>
      );
    }

    const promptIds = PROMPT_IDS_BY_ROLE[repoPromptRoleTab];
    const visibleErrorCount = promptIds.filter((templateId) =>
      Boolean(selectedRepoPromptValidationErrors[templateId]),
    ).length;

    return (
      <div className="grid gap-4 p-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Repository Prompt Overrides</h3>
          <p className="text-xs text-muted-foreground">
            Repository overrides take precedence over global overrides when enabled.
          </p>
        </div>

        {renderPromptTabButtons(
          repoPromptRoleTab,
          setRepoPromptRoleTab,
          selectedRepoPromptRoleTabErrorCounts,
        )}

        {visibleErrorCount > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {visibleErrorCount} prompt placeholder error{visibleErrorCount > 1 ? "s" : ""} in this
            tab.
          </div>
        ) : null}

        <div className="grid gap-3">
          {promptIds.map((templateId) => {
            const builtin = BUILTIN_PROMPTS_BY_ID[templateId];
            const repoOverride = selectedRepoConfig.promptOverrides[templateId];
            const canResetToBuiltin = canResetPromptOverrideToBuiltin(
              repoOverride,
              builtin.template,
            );
            const globalOverride = snapshotDraft.globalPromptOverrides[templateId];
            const globalEnabledOverride =
              globalOverride && globalOverride.enabled !== false ? globalOverride : undefined;

            const inheritedTemplate = globalEnabledOverride?.template ?? builtin.template;
            const inheritedSource = globalEnabledOverride ? "Global override" : "Builtin prompt";

            const inheritedPreview =
              repoOverride && repoOverride.enabled !== false
                ? undefined
                : {
                    sourceLabel: inheritedSource,
                    template: inheritedTemplate,
                  };

            return (
              <PromptOverrideCard
                key={templateId}
                label={PROMPT_TEMPLATE_LABELS[templateId]}
                description={PROMPT_TEMPLATE_DESCRIPTIONS[templateId]}
                override={repoOverride}
                inheritedPreview={inheritedPreview}
                disabled={isLoadingSettings || isSaving}
                canResetToBuiltin={canResetToBuiltin}
                validationError={selectedRepoPromptValidationErrors[templateId]}
                onToggleEnabled={(nextEnabled) => {
                  updateRepoPromptOverrides((currentOverrides) => {
                    const existing = currentOverrides[templateId];
                    if (nextEnabled) {
                      return {
                        ...currentOverrides,
                        [templateId]: {
                          template: existing?.template ?? inheritedTemplate,
                          baseVersion: existing?.baseVersion ?? builtin.builtinVersion,
                          enabled: true,
                        },
                      };
                    }

                    if (!existing) {
                      return currentOverrides;
                    }

                    return {
                      ...currentOverrides,
                      [templateId]: {
                        ...existing,
                        enabled: false,
                      },
                    };
                  });
                }}
                onTemplateChange={(nextTemplate) => {
                  updateRepoPromptOverrides((currentOverrides) => {
                    const existing = currentOverrides[templateId];
                    return {
                      ...currentOverrides,
                      [templateId]: {
                        template: nextTemplate,
                        baseVersion: existing?.baseVersion ?? builtin.builtinVersion,
                        enabled: existing ? existing.enabled !== false : false,
                      },
                    };
                  });
                }}
                onResetToBuiltin={() => {
                  updateRepoPromptOverrides((currentOverrides) =>
                    resetPromptOverrideToBuiltin(
                      currentOverrides,
                      templateId,
                      builtin.template,
                      builtin.builtinVersion,
                    ),
                  );
                }}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderRepositoriesSection = (): ReactElement => {
    return (
      <div className="grid h-full lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-3 border-r border-border bg-muted p-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Repository</Label>
            <RepositorySelector
              repoPaths={repoPaths}
              value={selectedRepoPath ?? ""}
              placeholder={repoPaths.length > 0 ? "Select repository" : "No repository configured"}
              searchPlaceholder="Search repository..."
              disabled={isLoadingSettings || isSaving || repoPaths.length === 0}
              errorCountByPath={promptValidationState.repoErrorCountByPath}
              onValueChange={setSelectedRepoPath}
            />
          </div>

          <div className="space-y-1">
            {REPOSITORY_SECTIONS.map((entry) => {
              const sectionErrorCount =
                entry.id === "prompts" ? selectedRepoPromptValidationErrorCount : 0;

              return (
                <Button
                  key={entry.id}
                  type="button"
                  variant={repositorySection === entry.id ? "accent" : "ghost"}
                  className="w-full justify-between"
                  disabled={isLoadingSettings || isSaving}
                  onClick={() => setRepositorySection(entry.id)}
                  title={
                    sectionErrorCount > 0
                      ? `${sectionErrorCount} prompt placeholder error${sectionErrorCount > 1 ? "s" : ""}`
                      : undefined
                  }
                >
                  <span>{entry.label}</span>
                  {sectionErrorCount > 0 ? (
                    <CircleAlert
                      className="size-3.5 shrink-0 text-destructive-muted"
                      aria-hidden="true"
                    />
                  ) : null}
                </Button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {repoPaths.length === 0 ? (
            <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
              Add a repository first, then configure repository settings.
            </div>
          ) : null}

          {repositorySection === "configuration"
            ? renderRepositoryConfiguration()
            : repositorySection === "agents"
              ? renderRepositoryAgents()
              : renderRepositoryPrompts()}
        </div>
      </div>
    );
  };

  const renderGeneralSection = (): ReactElement => {
    return (
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-foreground">General Settings</h3>
        <p className="text-sm text-muted-foreground">
          General application settings will live here. Repository-specific and prompt settings are
          now split into their dedicated sections.
        </p>
        <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
          Settings are persisted in <code>~/.openducktor/config.json</code> and saved atomically.
        </div>
      </div>
    );
  };

  const renderSectionContent = (): ReactElement => {
    if (settingsError) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load settings: {settingsError}
        </div>
      );
    }

    if (isLoadingSettings || !snapshotDraft) {
      return (
        <div className="rounded-md border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          Loading settings...
        </div>
      );
    }

    if (section === "general") {
      return renderGeneralSection();
    }

    if (section === "repositories") {
      return renderRepositoriesSection();
    }

    return renderGlobalPrompts();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSaving) {
          return;
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={triggerSize} className={cn(triggerClassName)}>
          <Settings2 className="size-4" />
          Settings
        </Button>
      </DialogTrigger>

      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-7xl flex-col p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure global defaults, repository settings, and prompt overrides.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-r border-border bg-muted/50 p-3">
              <div className="space-y-1">
                {SETTINGS_SECTIONS.map((entry) => {
                  const Icon = entry.icon;
                  const sectionErrorCount = settingsSectionErrorCountById[entry.id];
                  return (
                    <Button
                      key={entry.id}
                      type="button"
                      variant={section === entry.id ? "accent" : "ghost"}
                      className="w-full justify-between"
                      disabled={isLoadingSettings || isSaving}
                      onClick={() => setSection(entry.id)}
                      title={
                        sectionErrorCount > 0
                          ? `${sectionErrorCount} prompt placeholder error${sectionErrorCount > 1 ? "s" : ""}`
                          : undefined
                      }
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Icon className="size-4" />
                        <span className="truncate">{entry.label}</span>
                      </span>
                      {sectionErrorCount > 0 ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-destructive-muted">
                          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                        </span>
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            </aside>

            <div className="min-h-0 overflow-y-auto">{renderSectionContent()}</div>
          </div>
        </div>

        <DialogFooter className="mt-0 shrink-0 items-center justify-start border-t border-border px-6 pb-4 pt-4">

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
          <div className="flex grow items-center gap-2 text-sm">
            {saveError ? <span className="text-destructive-muted">{saveError}</span> : <span />}
            {!saveError && hasPromptValidationErrors ? (
              <span className="text-destructive-muted">
                {promptValidationState.totalErrorCount} prompt placeholder error
                {promptValidationState.totalErrorCount > 1 ? "s" : ""}.
              </span>
            ) : null}
            {catalogError && section === "repositories" && repositorySection === "configuration" ? (
              <span className="text-warning-muted">Catalog unavailable.</span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={
                isSaving ||
                isLoadingSettings ||
                !snapshotDraft ||
                Boolean(settingsError) ||
                hasPromptValidationErrors
              }
              onClick={() => void submit()}
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

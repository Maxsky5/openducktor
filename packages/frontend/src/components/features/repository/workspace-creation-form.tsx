import type {
  SettingsRepoConfig,
  WorkspacePathResolution,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { ArrowLeft, ArrowRight, FolderOpen } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo, useReducer, useRef } from "react";
import { toPrimaryAgentOptions } from "@/components/features/agents/catalog-select-options";
import { RepositoryModelDefaultsFields } from "@/components/features/settings/settings-repository-agents-section";
import { ensureDraftAgentDefault } from "@/components/features/settings/settings-modal-model";
import { WorkspaceIdentityFields } from "@/components/features/workspace-identity/workspace-identity-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import type {
  WorkspaceModelDefaultsDraft,
  WorkspaceSelectionOperationsInput,
} from "@/types/state-slices";
import type { WorkspaceCreationModelSurface } from "./use-workspace-creation-models";

const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAGES = [
  { id: "repository", label: "Repository folder" },
  { id: "information", label: "Workspace information" },
  { id: "models", label: "Models" },
] as const;
export type WorkspaceCreationStage = (typeof STAGES)[number]["id"];
type ModelDefaultsValue = Pick<SettingsRepoConfig, "defaultModel" | "agentDefaults">;

const deriveWorkspaceNameFromRepoPath = (repoPath: string): string => {
  const trimmedPath = repoPath.trim().replace(/[\\/]+$/, "");
  const segments = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1)?.trim() || repoPath.trim();
};

const proposeWorkspaceId = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";

const uniquifyWorkspaceId = (candidate: string, existingIds: Set<string>): string => {
  if (!existingIds.has(candidate)) return candidate;
  let suffix = 2;
  while (existingIds.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
};

const emptyModelDraft = (): WorkspaceModelDefaultsDraft => ({
  defaultModel: undefined,
  agentDefaults: {},
});

const selectedModelError = (
  draft: WorkspaceModelDefaultsDraft,
  surface: WorkspaceCreationModelSurface | undefined,
): string | null => {
  const definitionsByKind = new Map(
    surface?.availableRuntimeDefinitions.map((definition) => [definition.kind, definition]) ?? [],
  );
  const resourcesByKind = new Map(
    surface?.catalogResources.map((resource) => [resource.runtimeKind, resource]) ?? [],
  );
  const catalogsByKind = new Map(
    surface?.catalogResources.map((resource) => [
      resource.runtimeKind,
      surface.getCatalogForRuntime(resource.runtimeKind),
    ]) ?? [],
  );
  const modelsByKey = new Map(
    [...catalogsByKind].flatMap(
      ([runtimeKind, catalog]) =>
        catalog?.models.map(
          (model) => [`${runtimeKind}\0${model.providerId}\0${model.modelId}`, model] as const,
        ) ?? [],
    ),
  );
  const entries = [
    ["Default Model", draft.defaultModel],
    ["Specification", draft.agentDefaults.spec],
    ["Planner", draft.agentDefaults.planner],
    ["Builder", draft.agentDefaults.build],
    ["QA", draft.agentDefaults.qa],
  ] as const;
  for (const [label, entry] of entries) {
    if (!entry) continue;
    if (!entry.runtimeKind || !entry.providerId.trim() || !entry.modelId.trim()) {
      return `${label} needs a runtime and model. Choose a model or clear this choice.`;
    }
    const definition = definitionsByKind.get(entry.runtimeKind);
    const resource = resourcesByKind.get(entry.runtimeKind);
    const catalog = catalogsByKind.get(entry.runtimeKind);
    const model = modelsByKey.get(`${entry.runtimeKind}\0${entry.providerId}\0${entry.modelId}`);
    if (!definition || !resource?.isEnabled || resource.error || !model) {
      return `${label} is unavailable. Retry the model list or clear this choice.`;
    }
    if (entry.variant && !model.variants.includes(entry.variant)) {
      return `${label} has an unavailable effort or variant. Choose one again or clear this choice.`;
    }
    if (
      entry.profileId &&
      !toPrimaryAgentOptions(catalog ?? null).some((option) => option.value === entry.profileId)
    ) {
      return `${label} has an unavailable agent profile. Choose one again or clear this choice.`;
    }
  }
  return null;
};

type State = {
  stage: WorkspaceCreationStage;
  pickerOpen: boolean;
  repoPath: string;
  workspaceName: string;
  workspaceId: string;
  abbreviation: string;
  tileColor: string | null;
  editedId: boolean;
  modelDraft: WorkspaceModelDefaultsDraft;
  createdWorkspaceId: string | null;
  progress: "idle" | "creating" | "saving" | "finishing";
  error: string | null;
  errorStage: WorkspaceCreationStage | null;
};

type Action =
  | { type: "picker"; open: boolean }
  | { type: "repo"; repoPath: string; workspaceName: string; workspaceId: string }
  | { type: "stage"; stage: WorkspaceCreationStage; pickerOpen?: boolean }
  | { type: "name"; workspaceName: string; workspaceId: string }
  | { type: "id"; workspaceId: string }
  | { type: "abbreviation"; abbreviation: string }
  | { type: "tileColor"; tileColor: string | null }
  | {
      type: "models";
      updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft;
    }
  | { type: "created"; workspaceId: string }
  | { type: "progress"; value: State["progress"] }
  | { type: "error"; error: string | null; stage: WorkspaceCreationStage | null };

const initialState: State = {
  stage: "repository",
  pickerOpen: false,
  repoPath: "",
  workspaceName: "",
  workspaceId: "",
  abbreviation: "",
  tileColor: null,
  editedId: false,
  modelDraft: emptyModelDraft(),
  createdWorkspaceId: null,
  progress: "idle",
  error: null,
  errorStage: null,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "picker":
      return { ...state, pickerOpen: action.open, error: null };
    case "repo":
      if (state.repoPath === action.repoPath) {
        return { ...state, stage: "information", pickerOpen: false, error: null };
      }
      return {
        ...state,
        ...action,
        stage: "information",
        pickerOpen: false,
        abbreviation: "",
        tileColor: null,
        editedId: false,
        modelDraft: emptyModelDraft(),
        error: null,
      };
    case "stage":
      return { ...state, stage: action.stage, pickerOpen: action.pickerOpen ?? false, error: null };
    case "name":
      return { ...state, workspaceName: action.workspaceName, workspaceId: action.workspaceId };
    case "id":
      return { ...state, workspaceId: action.workspaceId, editedId: true };
    case "abbreviation":
      return { ...state, abbreviation: action.abbreviation };
    case "tileColor":
      return { ...state, tileColor: action.tileColor };
    case "models":
      return { ...state, modelDraft: action.updater(state.modelDraft), error: null };
    case "created":
      return { ...state, createdWorkspaceId: action.workspaceId };
    case "progress":
      return { ...state, progress: action.value };
    case "error":
      return { ...state, error: action.error, errorStage: action.stage };
  }
};

type WorkspaceCreationFormProps = {
  workspaces: WorkspaceRecord[];
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<WorkspaceRecord>;
  saveWorkspaceModelDefaults?: (
    workspaceId: string,
    draft: WorkspaceModelDefaultsDraft,
  ) => Promise<void>;
  disabled?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
  onSuccess?: (repoPath: string) => void | Promise<void>;
  resolveRepoPath?: (repoPath: string) => Promise<WorkspacePathResolution>;
  onReopenClosedWorkspace?: (workspace: WorkspaceRecord) => Promise<void>;
  runWorkspaceChange?: (change: () => Promise<void>) => Promise<boolean>;
};

export type WorkspaceCreationController = {
  stage: WorkspaceCreationStage;
  repoPath: string;
  workspaceName: string;
  workspaceId: string;
  abbreviation: string;
  tileColor: string | null;
  modelDraft: WorkspaceModelDefaultsDraft;
  createdWorkspaceId: string | null;
  pickerOpen: boolean;
  submitting: boolean;
  progress: State["progress"];
  busy: boolean;
  validationError: string | null;
  error: string | null;
  openPicker: () => void;
  closePicker: () => void;
  confirmRepo: (repoPath: string) => Promise<void>;
  reviewRepo: () => void;
  back: () => void;
  next: () => void;
  updateWorkspaceId: (workspaceId: string) => void;
  updateWorkspaceName: (workspaceName: string) => void;
  updateAbbreviation: (abbreviation: string) => void;
  updateTileColor: (tileColor: string | null) => void;
  updateModelDraft: (updater: (current: ModelDefaultsValue) => ModelDefaultsValue) => void;
  submit: (surface?: WorkspaceCreationModelSurface) => Promise<void>;
};

export function useWorkspaceCreation({
  workspaces,
  addWorkspace,
  saveWorkspaceModelDefaults,
  disabled = false,
  onSubmittingChange,
  onSuccess,
  resolveRepoPath,
  onReopenClosedWorkspace,
  runWorkspaceChange,
  initialPickerOpen = false,
}: WorkspaceCreationFormProps & { initialPickerOpen?: boolean }): WorkspaceCreationController {
  const [state, dispatch] = useReducer(reducer, { ...initialState, pickerOpen: initialPickerOpen });
  const submitInFlight = useRef(false);
  const existingIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.workspaceId)),
    [workspaces],
  );
  const duplicateRepo = workspaces.find((workspace) => workspace.repoPath === state.repoPath);
  let validationError: string | null = null;
  if (state.repoPath && !state.createdWorkspaceId) {
    if (duplicateRepo)
      validationError = `Repository is already configured as ${duplicateRepo.workspaceName}.`;
    else if (!state.workspaceName.trim()) validationError = "Workspace name cannot be blank.";
    else if (!WORKSPACE_ID_PATTERN.test(state.workspaceId.trim()))
      validationError =
        "Workspace ID must contain only lowercase letters, digits, and single dashes.";
    else if (existingIds.has(state.workspaceId.trim()))
      validationError = `Workspace ID already exists: ${state.workspaceId.trim()}`;
  }
  const submitting = state.progress !== "idle";
  const busy = disabled || submitting;
  const runChange =
    runWorkspaceChange ??
    (async (change: () => Promise<void>) => {
      await change();
      return true;
    });

  const confirmRepo = async (repoPath: string): Promise<void> => {
    if (busy || state.createdWorkspaceId) return;
    const resolution = await resolveRepoPath?.(repoPath);
    if (resolution?.kind === "removing") {
      throw new Error(
        `Workspace removal is incomplete for ${resolution.removal.workspace.workspaceName}. Retry removal from the workspace rail.`,
      );
    }
    if (resolution?.kind === "open") {
      throw new Error(`Repository is already configured as ${resolution.workspace.workspaceName}.`);
    }
    if (resolution?.kind === "closed") {
      if (!onReopenClosedWorkspace) throw new Error("Cannot reopen this workspace from here.");
      if (!(await runChange(() => onReopenClosedWorkspace(resolution.workspace)))) return;
      await onSuccess?.(resolution.workspace.repoPath);
      return;
    }
    const workspaceName = deriveWorkspaceNameFromRepoPath(repoPath);
    dispatch({
      type: "repo",
      repoPath,
      workspaceName,
      workspaceId: uniquifyWorkspaceId(proposeWorkspaceId(workspaceName), existingIds),
    });
  };

  const submit = async (surface?: WorkspaceCreationModelSurface): Promise<void> => {
    if (
      submitInFlight.current ||
      disabled ||
      state.stage !== "models" ||
      !state.repoPath ||
      validationError
    )
      return;
    const modelError = selectedModelError(state.modelDraft, surface);
    if (modelError) {
      dispatch({ type: "error", error: modelError, stage: "models" });
      return;
    }
    submitInFlight.current = true;
    onSubmittingChange?.(true);
    dispatch({ type: "error", error: null, stage: null });
    try {
      const completed = await runChange(async () => {
        let workspaceId = state.createdWorkspaceId;
        if (!workspaceId) {
          dispatch({ type: "progress", value: "creating" });
          const workspaceInput: WorkspaceSelectionOperationsInput = {
            workspaceId: state.workspaceId.trim(),
            workspaceName: state.workspaceName.trim(),
            repoPath: state.repoPath,
          };
          if (state.abbreviation.trim()) workspaceInput.abbreviation = state.abbreviation.trim();
          if (state.tileColor) workspaceInput.tileColor = state.tileColor;
          const workspace = await addWorkspace(workspaceInput);
          workspaceId = workspace.workspaceId;
          dispatch({ type: "created", workspaceId });
        }
        if (
          state.modelDraft.defaultModel ||
          Object.values(state.modelDraft.agentDefaults).some(Boolean)
        ) {
          if (!saveWorkspaceModelDefaults)
            throw new Error("Model defaults cannot be saved from this form.");
          dispatch({ type: "progress", value: "saving" });
          await saveWorkspaceModelDefaults(workspaceId, state.modelDraft);
        }
      });
      if (!completed) return;
      dispatch({ type: "progress", value: "finishing" });
      await onSuccess?.(state.repoPath);
    } catch (cause) {
      dispatch({ type: "error", error: errorMessage(cause), stage: "models" });
    } finally {
      submitInFlight.current = false;
      dispatch({ type: "progress", value: "idle" });
      onSubmittingChange?.(false);
    }
  };

  return {
    stage: state.stage,
    repoPath: state.repoPath,
    workspaceName: state.workspaceName,
    workspaceId: state.workspaceId,
    abbreviation: state.abbreviation,
    tileColor: state.tileColor,
    modelDraft: state.modelDraft,
    createdWorkspaceId: state.createdWorkspaceId,
    pickerOpen: state.pickerOpen,
    submitting,
    progress: state.progress,
    busy,
    validationError,
    error: state.errorStage === state.stage ? state.error : null,
    openPicker: () => {
      if (!busy && !state.createdWorkspaceId) dispatch({ type: "picker", open: true });
    },
    closePicker: () => {
      if (!busy) dispatch({ type: "picker", open: false });
    },
    confirmRepo,
    reviewRepo: () => {
      if (!busy && state.repoPath) dispatch({ type: "stage", stage: "information" });
    },
    back: () => {
      if (busy || state.createdWorkspaceId) return;
      if (state.stage === "models") dispatch({ type: "stage", stage: "information" });
      else if (state.stage === "information") dispatch({ type: "stage", stage: "repository" });
    },
    next: () => {
      if (!busy && state.stage === "information" && !validationError)
        dispatch({ type: "stage", stage: "models" });
    },
    updateWorkspaceId: (workspaceId) => dispatch({ type: "id", workspaceId: workspaceId.trim() }),
    updateWorkspaceName: (workspaceName) =>
      dispatch({
        type: "name",
        workspaceName,
        workspaceId: state.editedId
          ? state.workspaceId
          : uniquifyWorkspaceId(proposeWorkspaceId(workspaceName), existingIds),
      }),
    updateAbbreviation: (abbreviation) => dispatch({ type: "abbreviation", abbreviation }),
    updateTileColor: (tileColor) => dispatch({ type: "tileColor", tileColor }),
    updateModelDraft: (updater) => dispatch({ type: "models", updater }),
    submit,
  };
}

function WorkspaceRepositoryChooser({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement {
  return (
    <div className="grid gap-3">
      {controller.repoPath ? (
        <div className="grid gap-1">
          <Label htmlFor="workspace-selected-repo-path">Selected repository path</Label>
          <Input id="workspace-selected-repo-path" value={controller.repoPath} readOnly />
        </div>
      ) : null}
      <Button type="button" size="lg" className="w-fit" onClick={controller.openPicker}>
        <FolderOpen data-icon="inline-start" />
        {controller.repoPath ? "Choose different repository" : "Choose repository folder"}
      </Button>
    </div>
  );
}

function WorkspaceRepositoryFields({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement {
  const invalidWorkspaceId = controller.validationError?.startsWith("Workspace ID") ?? false;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-repo-path">Repository path</Label>
        <Input id="workspace-repo-path" value={controller.repoPath} readOnly />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-id">Workspace ID</Label>
        <Input
          id="workspace-id"
          value={controller.workspaceId}
          aria-invalid={invalidWorkspaceId}
          onChange={(event) => controller.updateWorkspaceId(event.currentTarget.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          value={controller.workspaceName}
          onChange={(event) => controller.updateWorkspaceName(event.currentTarget.value)}
        />
      </div>
      <WorkspaceIdentityFields
        idPrefix="workspace-create"
        workspaceName={controller.workspaceName}
        abbreviation={controller.abbreviation || null}
        tileColor={controller.tileColor}
        isDisabled={controller.busy}
        onChangeAbbreviation={controller.updateAbbreviation}
        onChangeTileColor={controller.updateTileColor}
      />
    </div>
  );
}

function WorkspaceModelsFields({
  controller,
  surface,
}: {
  controller: WorkspaceCreationController;
  surface?: WorkspaceCreationModelSurface | undefined;
}): ReactElement {
  if (!surface)
    return (
      <p className="text-sm text-muted-foreground">
        Model choices are unavailable. You can open this repository without defaults.
      </p>
    );
  return (
    <div className="space-y-3">
      <div className="grid gap-1">
        <Label htmlFor="workspace-models-repo-path">Repository path</Label>
        <Input id="workspace-models-repo-path" value={controller.repoPath} readOnly />
      </div>
      <p className="text-sm text-muted-foreground">
        Choose defaults for this workspace. You can leave every choice blank.
      </p>
      <RepositoryModelDefaultsFields
        selectedRepoConfig={controller.modelDraft}
        availableRuntimeDefinitions={surface.availableRuntimeDefinitions}
        catalogResources={surface.catalogResources}
        favoriteState={surface.favoriteState}
        loadingState={{
          isLoadingRuntimeDefinitions: surface.isLoadingRuntimeDefinitions,
          isLoadingCatalog: surface.isLoadingCatalog,
          isLoadingSettings: false,
          isSaving: controller.busy,
        }}
        runtimeDefinitionsError={null}
        runtimeAvailabilityErrors={surface.errors}
        getCatalogForRuntime={surface.getCatalogForRuntime}
        isCatalogLoadingForRuntime={surface.isCatalogLoadingForRuntime}
        onUpdateSelectedRepoConfig={controller.updateModelDraft}
        onUpdateSelectedRepoAgentDefault={(role, field, value) =>
          controller.updateModelDraft((current) => {
            const roleDefault = current.agentDefaults[role];
            return {
              ...current,
              agentDefaults: {
                ...current.agentDefaults,
                [role]: {
                  ...ensureDraftAgentDefault(roleDefault),
                  runtimeKind: roleDefault?.runtimeKind ?? current.defaultModel?.runtimeKind,
                  [field]: value,
                },
              },
            };
          })
        }
        onClearSelectedRepoAgentDefault={(role) =>
          controller.updateModelDraft((current) => ({
            ...current,
            agentDefaults: { ...current.agentDefaults, [role]: undefined },
          }))
        }
        onUpdateSelectedRepoDefaultModel={(field, value) =>
          controller.updateModelDraft((current) => ({
            ...current,
            defaultModel: current.defaultModel
              ? { ...current.defaultModel, [field]: value }
              : current.defaultModel,
          }))
        }
        onClearSelectedRepoDefaultModel={() =>
          controller.updateModelDraft((current) => ({ ...current, defaultModel: undefined }))
        }
      />
      {surface.errors.length > 0 ? (
        <Button type="button" variant="outline" onClick={() => void surface.retry()}>
          Retry model list
        </Button>
      ) : null}
    </div>
  );
}

export function WorkspaceCreationFields({
  controller,
  picker,
  modelSurface,
}: {
  controller: WorkspaceCreationController;
  picker?: ReactNode;
  modelSurface?: WorkspaceCreationModelSurface | undefined;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ol className="grid grid-cols-3 gap-2" aria-label="Workspace setup stages">
        {STAGES.map((step, index) => (
          <li
            key={step.id}
            aria-current={controller.stage === step.id ? "step" : undefined}
            className={`rounded-md border px-2 py-2 text-xs sm:text-sm ${controller.stage === step.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            {index + 1}. {step.label}
          </li>
        ))}
      </ol>
      <fieldset disabled={controller.busy} className="flex min-w-0 flex-col gap-4">
        {controller.stage === "repository" ? (
          picker !== undefined && controller.pickerOpen ? (
            picker
          ) : (
            <WorkspaceRepositoryChooser controller={controller} />
          )
        ) : null}
        {controller.stage === "information" ? (
          <WorkspaceRepositoryFields controller={controller} />
        ) : null}
        {controller.stage === "models" ? (
          <WorkspaceModelsFields controller={controller} surface={modelSurface} />
        ) : null}
      </fieldset>
      {controller.error || (controller.stage === "information" && controller.validationError) ? (
        <p className="text-sm text-destructive" role="alert">
          {controller.error ?? controller.validationError}
        </p>
      ) : null}
    </div>
  );
}

export function WorkspaceCreationBackAction({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement | null {
  if (controller.stage === "repository" || controller.createdWorkspaceId) return null;
  return (
    <Button type="button" variant="outline" disabled={controller.busy} onClick={controller.back}>
      <ArrowLeft data-icon="inline-start" /> Back
    </Button>
  );
}

export function WorkspaceCreationSubmitAction({
  controller,
  modelSurface,
}: {
  controller: WorkspaceCreationController;
  modelSurface?: WorkspaceCreationModelSurface | undefined;
}): ReactElement | null {
  if (controller.stage === "repository") {
    return controller.repoPath && !controller.pickerOpen ? (
      <Button type="button" disabled={controller.busy} onClick={controller.reviewRepo}>
        Continue to workspace information <ArrowRight data-icon="inline-end" />
      </Button>
    ) : null;
  }
  if (controller.stage === "information") {
    return (
      <Button
        type="button"
        disabled={controller.busy || controller.validationError !== null}
        onClick={controller.next}
      >
        Continue to models <ArrowRight data-icon="inline-end" />
      </Button>
    );
  }
  const progressLabel =
    controller.progress === "creating"
      ? "Creating workspace..."
      : controller.progress === "saving"
        ? "Saving model defaults..."
        : controller.progress === "finishing"
          ? "Opening repository..."
          : "Open repository";
  return (
    <Button
      type="button"
      disabled={controller.busy || controller.validationError !== null}
      onClick={() => void controller.submit(modelSurface)}
    >
      {progressLabel}
    </Button>
  );
}

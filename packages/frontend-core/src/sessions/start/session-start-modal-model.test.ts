import { describe, expect, test } from "bun:test";
import {
  buildSessionStartConfirmDraft,
  resolveSessionStartAvailability,
  type SessionStartModalModel,
} from "./session-start-modal-model";

const sourceOption = {
  value: "source-1",
  label: "Builder #1",
  sourceSession: {
    externalSessionId: "source-1",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo/worktree",
  },
};

const createModel = (overrides: Partial<SessionStartModalModel> = {}): SessionStartModalModel => ({
  phase: { kind: "choices" },
  onContinueInBackground: () => {},
  onEditChoices: () => {},
  open: true,
  title: "Start Builder Session",
  description: "Choose how to start.",
  confirmLabel: "Start session",
  selectedModelSelection: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
  selectedRuntimeKind: "opencode",
  modelPickerRuntimes: [],
  favoriteState: {
    favorites: [],
    isLoading: false,
    readError: null,
    isMutationPending: false,
    mutationError: null,
    canMutate: true,
    toggleFavorite: () => {},
    retryRead: () => {},
    retryMutation: () => {},
  },
  supportsProfiles: true,
  supportsVariants: true,
  selectionCatalogError: null,
  isSelectionCatalogLoading: false,
  runtimeDefinitionsError: null,
  isRuntimeDefinitionsLoading: false,
  onRetryRuntimeDefinitions: () => {},
  runtimeSettingsError: null,
  isRuntimeSettingsLoading: false,
  hasRuntimeSettingsSnapshot: true,
  onRetryRuntimeSettings: () => {},
  runtimeProfileOptions: [{ value: "build-agent", label: "build-agent" }],
  variantOptions: [{ value: "high", label: "high" }],
  availableStartModes: ["fresh", "reuse"],
  selectedStartMode: "fresh",
  existingSessionOptions: [sourceOption],
  selectedSourceSessionValue: "source-1",
  onSelectStartMode: () => {},
  onSelectSourceSessionValue: () => {},
  onSelectRuntimeProfile: () => {},
  onSelectModelPair: () => {},
  onSelectVariant: () => {},
  isStarting: false,
  onOpenChange: () => {},
  onConfirm: () => {},
  ...overrides,
});

const validKickoff = { kickoffInvalid: false };

const blockedReasonOf = (
  overrides: Partial<SessionStartModalModel>,
  kickoffInvalid = false,
): string | null =>
  resolveSessionStartAvailability(createModel(overrides), { kickoffInvalid }).blockedReason;

describe("resolveSessionStartAvailability", () => {
  test("allows a fresh start with a runtime and a model", () => {
    expect(resolveSessionStartAvailability(createModel(), validKickoff)).toEqual({
      hasExistingSessionOptions: true,
      isReuseMode: false,
      requiresExistingSession: false,
      confirmDisabled: false,
      blockedReason: null,
      runtimeProfileDisabled: false,
      variantDisabled: false,
    });
  });

  test("blocks a fresh start while the catalog loads or failed", () => {
    expect(
      resolveSessionStartAvailability(
        createModel({ isSelectionCatalogLoading: true }),
        validKickoff,
      ).confirmDisabled,
    ).toBe(true);
    expect(
      resolveSessionStartAvailability(
        createModel({ selectionCatalogError: "Catalog failed" }),
        validKickoff,
      ).confirmDisabled,
    ).toBe(true);
  });

  test("lets a reuse start ignore the catalog but requires a source session", () => {
    const reuse = createModel({
      selectedStartMode: "reuse",
      isSelectionCatalogLoading: true,
      selectedModelSelection: null,
    });
    expect(resolveSessionStartAvailability(reuse, validKickoff)).toMatchObject({
      isReuseMode: true,
      requiresExistingSession: true,
      confirmDisabled: false,
      runtimeProfileDisabled: true,
      variantDisabled: true,
    });
    expect(
      resolveSessionStartAvailability(
        { ...reuse, selectedSourceSessionValue: "missing" },
        validKickoff,
      ).confirmDisabled,
    ).toBe(true);
  });

  test("blocks a start while the kickoff prompt loads or failed", () => {
    expect(
      resolveSessionStartAvailability(createModel({ isKickoffPromptLoading: true }), validKickoff)
        .confirmDisabled,
    ).toBe(true);
    expect(
      resolveSessionStartAvailability(
        createModel({ kickoffPromptError: "No prompt" }),
        validKickoff,
      ).confirmDisabled,
    ).toBe(true);
  });

  test("blocks a start until runtime settings exist", () => {
    expect(
      resolveSessionStartAvailability(
        createModel({ hasRuntimeSettingsSnapshot: false, isRuntimeSettingsLoading: true }),
        validKickoff,
      ).confirmDisabled,
    ).toBe(true);
    expect(
      resolveSessionStartAvailability(
        createModel({ hasRuntimeSettingsSnapshot: true, runtimeSettingsError: "Stale" }),
        validKickoff,
      ).confirmDisabled,
    ).toBe(false);
  });
});

describe("session start blocked reason", () => {
  test("gives no reason when Start is enabled or a start runs", () => {
    expect(blockedReasonOf({})).toBeNull();
    const running = resolveSessionStartAvailability(
      createModel({ isStarting: true, selectedModelSelection: null }),
      { kickoffInvalid: true },
    );
    expect(running).toMatchObject({ blockedReason: null, confirmDisabled: true });
  });

  test("names the runtime, settings, and prompt reads that block Start", () => {
    expect(blockedReasonOf({ isRuntimeDefinitionsLoading: true })).toBe("Loading the runtimes…");
    expect(blockedReasonOf({ runtimeDefinitionsError: "Down" })).toBe("The runtimes did not load.");
    expect(
      blockedReasonOf({ hasRuntimeSettingsSnapshot: false, runtimeSettingsError: "Down" }),
    ).toBe("The runtime settings did not load.");
    expect(blockedReasonOf({ runtimeSettingsError: "Down" })).toBeNull();
    expect(blockedReasonOf({ kickoffPromptError: "Down" })).toBe(
      "The kickoff prompt did not load.",
    );
  });

  test("asks for a model, except in reuse mode", () => {
    expect(blockedReasonOf({ selectedModelSelection: null })).toBe("Choose a model to start.");
    expect(blockedReasonOf({ isSelectionCatalogLoading: true })).toBe("Loading the models…");
    expect(
      blockedReasonOf({ selectedStartMode: "reuse", selectedModelSelection: null }),
    ).toBeNull();
  });

  test("asks for a target branch when the start shows the choice without a branch", () => {
    expect(blockedReasonOf({ showTargetBranchSelector: true, selectedTargetBranch: "" })).toBe(
      "Choose a target branch to start.",
    );
    expect(
      blockedReasonOf({ showTargetBranchSelector: true, selectedTargetBranch: "refs/heads/main" }),
    ).toBeNull();
    expect(
      blockedReasonOf({ showTargetBranchSelector: false, selectedTargetBranch: "" }),
    ).toBeNull();
  });

  test("asks for a source session for reuse and fork", () => {
    expect(blockedReasonOf({ selectedStartMode: "fork", selectedSourceSessionValue: "" })).toBe(
      "Choose a source session to start.",
    );
  });

  test("blocks blank custom instructions", () => {
    const availability = resolveSessionStartAvailability(createModel(), { kickoffInvalid: true });
    expect(availability).toMatchObject({
      blockedReason: "Write the custom instructions, or turn them off.",
      confirmDisabled: true,
    });
  });
});

describe("buildSessionStartConfirmDraft", () => {
  test("sends a source session only when the start mode needs one", () => {
    expect(
      buildSessionStartConfirmDraft({
        model: createModel(),
        requiresExistingSession: false,
        speedChange: undefined,
        kickoffPrompt: undefined,
      }),
    ).toEqual({ startMode: "fresh", sourceSessionOptionValue: null });
    expect(
      buildSessionStartConfirmDraft({
        model: createModel({ selectedStartMode: "fork" }),
        requiresExistingSession: true,
        speedChange: undefined,
        kickoffPrompt: undefined,
      }),
    ).toEqual({ startMode: "fork", sourceSessionOptionValue: "source-1" });
  });

  test("adds the changed speed, the kickoff prompt, and the shown target branch", () => {
    expect(
      buildSessionStartConfirmDraft({
        model: createModel({ showTargetBranchSelector: true, selectedTargetBranch: "" }),
        requiresExistingSession: false,
        speedChange: "fast",
        kickoffPrompt: "Build the task.",
      }),
    ).toEqual({
      startMode: "fresh",
      sourceSessionOptionValue: null,
      speed: "fast",
      kickoffPrompt: "Build the task.",
      targetBranch: "",
    });
  });
});

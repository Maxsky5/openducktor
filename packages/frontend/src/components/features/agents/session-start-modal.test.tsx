import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { AppRuntimeProvider } from "@/state/providers/app-runtime-provider";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { SessionStartModal, type SessionStartModalModel } from "./session-start-modal";

enableReactActEnvironment();

const noop = () => {};
const existingSessionOption = (externalSessionId: string) => ({
  value: `opencode\u0000${externalSessionId}\u0000/repo/worktree`,
  sourceSession: {
    externalSessionId,
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo/worktree",
  },
  label: "Session #1",
});

const createModel = (overrides: Partial<SessionStartModalModel> = {}): SessionStartModalModel => ({
  open: true,
  title: "Start Builder session",
  description: "Pick a model and launch a session.",
  confirmLabel: "Start session",
  cancelLabel: "Cancel",
  selectedModelSelection: {
    profileId: "builder",
    providerId: "openai",
    modelId: "gpt-5.4",
    variant: "default",
  },
  selectedRuntimeKind: "opencode",
  modelPickerRuntimes: [
    {
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      resource: {
        status: "ready",
        catalog: {
          runtime: OPENCODE_RUNTIME_DESCRIPTOR,
          models: [
            {
              id: "openai/gpt-5.4",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "gpt-5.4",
              modelName: "GPT-5.4",
              variants: ["default"],
            },
          ],
          defaultModelsByProvider: {},
        },
      },
    },
  ],
  favoriteState: {
    favorites: [],
    isLoading: false,
    readError: null,
    isMutationPending: false,
    mutationError: null,
    canMutate: true,
    toggleFavorite: noop,
    retryRead: noop,
    retryMutation: noop,
  },
  supportsProfiles: true,
  supportsVariants: true,
  selectionCatalogError: null,
  isSelectionCatalogLoading: false,
  runtimeDefinitionsError: null,
  isRuntimeDefinitionsLoading: false,
  onRetryRuntimeDefinitions: noop,
  runtimeSettingsError: null,
  isRuntimeSettingsLoading: false,
  hasRuntimeSettingsSnapshot: true,
  onRetryRuntimeSettings: noop,
  runtimeProfileOptions: [{ value: "builder", label: "Builder" }],
  variantOptions: [{ value: "default", label: "Default" }],
  availableStartModes: ["fresh"],
  selectedStartMode: "fresh",
  existingSessionOptions: [],
  selectedSourceSessionValue: "",
  onSelectStartMode: noop,
  onSelectSourceSessionValue: noop,
  onSelectRuntimeProfile: noop,
  onSelectModelPair: noop,
  onSelectVariant: noop,
  allowRunInBackground: true,
  isStarting: false,
  onOpenChange: noop,
  onConfirm: noop,
  ...overrides,
});

const ProviderBackedSessionStartModal = () => {
  const runtimeState = useRuntimeDefinitionsContext();
  return (
    <SessionStartModal
      model={createModel({
        selectedModelSelection: {
          runtimeKind: "opencode",
          profileId: "builder",
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "default",
        },
        runtimeDefinitionsError: runtimeState.runtimeDefinitionsError,
        isRuntimeDefinitionsLoading: runtimeState.isLoadingRuntimeDefinitions,
        onRetryRuntimeDefinitions: () => void runtimeState.refreshRuntimeDefinitions(),
        runtimeSettingsError: runtimeState.runtimeSettingsError,
        isRuntimeSettingsLoading: runtimeState.isLoadingRuntimeSettings,
        hasRuntimeSettingsSnapshot: runtimeState.hasRuntimeSettingsSnapshot,
        onRetryRuntimeSettings: () => void runtimeState.refreshRuntimeSettings(),
      })}
    />
  );
};

const getFieldButton = (testId: string): HTMLButtonElement => {
  const button = screen.getByTestId(testId).querySelector("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${testId} combobox button`);
  }
  return button;
};

describe("SessionStartModal", () => {
  test("submits through the form action", () => {
    const onConfirm = mock(() => {});
    const { unmount } = render(
      createElement(SessionStartModal, { model: createModel({ onConfirm }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      runInBackground: false,
      startMode: "fresh",
      sourceSessionOptionValue: null,
    });

    expect(screen.getByRole("button", { name: /start session/i })).toBeTruthy();

    unmount();
  });

  test("makes the combined picker read-only and explains reuse mode from the keyboard", async () => {
    const onSelectModelPair = mock(() => {});
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          availableStartModes: ["fresh", "reuse"],
          selectedStartMode: "reuse",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
          onSelectModelPair,
        }),
      }),
    );

    const sourceCombobox = getFieldButton("session-start-source-field");
    const runtimeProfileCombobox = getFieldButton("session-start-runtime-profile-field");
    const modelPicker = getFieldButton("session-start-model-picker-field");
    const variantCombobox = getFieldButton("session-start-variant-field");

    expect(sourceCombobox.hasAttribute("disabled")).toBe(false);
    expect(runtimeProfileCombobox.hasAttribute("disabled")).toBe(true);
    expect(modelPicker.hasAttribute("disabled")).toBe(false);
    expect(modelPicker.getAttribute("aria-disabled")).toBe("true");
    const reasonId = modelPicker.getAttribute("aria-describedby");
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId ?? "")?.textContent).toBe(
      "Reuse mode keeps the source session runtime and model.",
    );
    expect(variantCombobox.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      modelPicker.focus();
    });
    expect(document.activeElement).toBe(modelPicker);
    await act(async () => {
      fireEvent.keyDown(modelPicker, { key: "Enter" });
      fireEvent.keyUp(modelPicker, { key: "Enter" });
      fireEvent.keyDown(modelPicker, { key: " " });
      fireEvent.keyUp(modelPicker, { key: " " });
    });

    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
    expect(onSelectModelPair).not.toHaveBeenCalled();

    unmount();
  });

  test("allows reuse confirm while catalog is loading", () => {
    const onConfirm = mock(() => {});
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          isSelectionCatalogLoading: true,
          selectedModelSelection: null,
          availableStartModes: ["fresh", "reuse"],
          selectedStartMode: "reuse",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
          onConfirm,
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      runInBackground: false,
      startMode: "reuse",
      sourceSessionOptionValue: existingSessionOption("session-1").value,
    });

    unmount();
  });

  test("disables fresh-session selection and confirm while the catalog loads", () => {
    const onConfirm = mock(() => {});
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          isSelectionCatalogLoading: true,
          modelPickerRuntimes: [],
          onConfirm,
        }),
      }),
    );

    expect(getFieldButton("session-start-runtime-profile-field").hasAttribute("disabled")).toBe(
      true,
    );
    const modelPicker = getFieldButton("session-start-model-picker-field");
    expect(modelPicker.hasAttribute("disabled")).toBe(false);
    expect(modelPicker.textContent).toContain("Loading models...");
    expect(getFieldButton("session-start-variant-field").hasAttribute("disabled")).toBe(true);

    const confirmButton = screen.getByRole("button", { name: /start session/i });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();

    unmount();
  });

  test("shows reuse helper text even when catalog is loading", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          isSelectionCatalogLoading: true,
          selectedModelSelection: null,
          availableStartModes: ["fresh", "reuse"],
          selectedStartMode: "reuse",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
        }),
      }),
    );

    expect(
      screen.getByText(
        "Reuse mode keeps the previous session runtime profile, model, and variant.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Runtime profile")).toBeTruthy();
    expect(screen.queryByText("Loading profiles for the selected runtime.")).toBeNull();

    unmount();
  });

  test("shows catalog load errors and blocks fresh-session confirm", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          selectionCatalogError: "Claude auth failed",
          selectedModelSelection: null,
          variantOptions: [],
        }),
      }),
    );

    expect(screen.getByRole("button", { name: /start session/i }).hasAttribute("disabled")).toBe(
      true,
    );

    unmount();
  });

  test("shows runtime-definition errors with a retry and blocks session start", () => {
    const onRetryRuntimeDefinitions = mock(() => {});
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          runtimeDefinitionsError: "Runtime definitions failed",
          modelPickerRuntimes: [],
          selectedModelSelection: null,
          selectedRuntimeKind: null,
          onRetryRuntimeDefinitions,
        }),
      }),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Runtime definitions unavailable: Runtime definitions failed",
    );
    expect(screen.queryByText("No agent runtimes are available.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryRuntimeDefinitions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /start session/i }).hasAttribute("disabled")).toBe(
      true,
    );
    unmount();
  });

  test("shows runtime-definition loading apart from an empty runtime list", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          isRuntimeDefinitionsLoading: true,
          modelPickerRuntimes: [],
          selectedModelSelection: null,
          selectedRuntimeKind: null,
        }),
      }),
    );

    expect(screen.getByRole("status").textContent).toContain("Loading agent runtimes...");
    expect(screen.queryByText("No agent runtimes are available.")).toBeNull();
    expect(screen.getByRole("button", { name: /start session/i }).hasAttribute("disabled")).toBe(
      true,
    );
    unmount();
  });

  test("retries a settings-only startup failure through the settings query", async () => {
    let settingsAttempts = 0;
    const runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]);
    const workspaceGetSettingsSnapshot = mock(async () => {
      settingsAttempts += 1;
      if (settingsAttempts === 1) {
        throw new Error("Settings unavailable");
      }
      return createSettingsSnapshotFixture();
    });
    configureShellBridge(
      createShellBridgeFixture({
        client: { runtimeDefinitionsList, workspaceGetSettingsSnapshot },
      }),
    );

    const { unmount } = render(
      <QueryProvider useIsolatedClient>
        <AppRuntimeProvider
          loadRepoRuntimeCatalog={async () => {
            throw new Error("catalog loader not configured");
          }}
          loadRepoRuntimeSlashCommands={async () => ({ commands: [] })}
          loadRepoRuntimeSkills={async () => ({ skills: [] })}
          loadRepoRuntimeSubagents={async () => ({ subagents: [] })}
          loadRepoRuntimeFileSearch={async () => []}
        >
          <ProviderBackedSessionStartModal />
        </AppRuntimeProvider>
      </QueryProvider>,
    );

    try {
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain(
          "Runtime settings unavailable: Settings unavailable",
        );
      });
      expect(screen.queryByText(/Runtime definitions unavailable/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Select model, OpenCode, GPT-5.4" }),
        ).toBeTruthy();
      });
      expect(settingsAttempts).toBe(2);
      expect(runtimeDefinitionsList).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("hides the runtime profile selector when the runtime manages profiles", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          supportsProfiles: false,
          selectedModelSelection: {
            providerId: "openai",
            modelId: "gpt-5.4",
            variant: "default",
          },
          runtimeProfileOptions: [],
        }),
      }),
    );

    expect(screen.queryByTestId("session-start-runtime-profile-field")).toBeNull();
    expect(screen.getByTestId("session-start-model-picker-field")).toBeTruthy();

    unmount();
  });

  test("keeps existing-session selection visible and model controls enabled in fork mode", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          availableStartModes: ["reuse", "fork"],
          selectedStartMode: "fork",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
        }),
      }),
    );

    expect(screen.getByText("Session Mode")).toBeTruthy();
    expect(screen.getByRole("button", { name: /reuse existing/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /fork existing/i })).toBeTruthy();
    expect(screen.getByText("Existing Session")).toBeTruthy();

    const sourceCombobox = getFieldButton("session-start-source-field");
    const runtimeProfileCombobox = getFieldButton("session-start-runtime-profile-field");
    const modelPicker = getFieldButton("session-start-model-picker-field");
    const variantCombobox = getFieldButton("session-start-variant-field");

    expect(sourceCombobox.hasAttribute("disabled")).toBe(false);
    expect(runtimeProfileCombobox.hasAttribute("disabled")).toBe(false);
    expect(modelPicker.hasAttribute("disabled")).toBe(false);
    expect(variantCombobox.hasAttribute("disabled")).toBe(false);

    unmount();
  });

  test("styles session mode selection with the segmented control tokens", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          availableStartModes: ["fresh", "reuse", "fork"],
          selectedStartMode: "reuse",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
        }),
      }),
    );

    const reuseButton = screen.getByRole("button", { name: /reuse existing/i });
    const freshButton = screen.getByRole("button", { name: /start fresh/i });

    expect(reuseButton.className).toContain("bg-selected-control");
    expect(reuseButton.className).not.toContain("bg-primary");
    expect(freshButton.className).not.toContain("bg-selected-control");

    unmount();
  });
});

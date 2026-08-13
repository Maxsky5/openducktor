import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { SessionStartModal, type SessionStartModalModel } from "./session-start-modal";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

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
  runtimeOptions: [{ value: "opencode", label: "OpenCode" }],
  modelPickerRuntimes: [
    {
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      resource: {
        runtimeKind: "opencode",
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
        isLoading: false,
        error: null,
        retry: async () => {},
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
  runtimeProfileOptions: [{ value: "builder", label: "Builder" }],
  modelOptions: [{ value: "openai/gpt-5.4", label: "GPT-5.4" }],
  modelGroups: [],
  variantOptions: [{ value: "default", label: "Default" }],
  availableStartModes: ["fresh"],
  selectedStartMode: "fresh",
  existingSessionOptions: [],
  selectedSourceSessionValue: "",
  onSelectStartMode: noop,
  onSelectSourceSessionValue: noop,
  onSelectRuntime: noop,
  onSelectRuntimeProfile: noop,
  onSelectModel: noop,
  onSelectModelPair: noop,
  onSelectVariant: noop,
  allowRunInBackground: true,
  isStarting: false,
  onOpenChange: noop,
  onConfirm: noop,
  ...overrides,
});

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

  test("makes the combined picker read-only when reusing an existing session", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          availableStartModes: ["fresh", "reuse"],
          selectedStartMode: "reuse",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
        }),
      }),
    );

    const sourceCombobox = getFieldButton("session-start-source-field");
    const runtimeProfileCombobox = getFieldButton("session-start-runtime-profile-field");
    const modelPicker = getFieldButton("session-start-model-picker-field");
    const variantCombobox = getFieldButton("session-start-variant-field");

    expect(sourceCombobox.hasAttribute("disabled")).toBe(false);
    expect(runtimeProfileCombobox.hasAttribute("disabled")).toBe(true);
    expect(modelPicker.hasAttribute("disabled")).toBe(true);
    expect(variantCombobox.hasAttribute("disabled")).toBe(true);

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
          modelOptions: [],
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

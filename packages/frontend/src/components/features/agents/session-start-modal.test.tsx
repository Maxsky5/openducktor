import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { SessionStartModalModel } from "./session-start-modal";

const omitDialogDomProps = ({
  onOpenChange: _onOpenChange,
  open: _open,
  ...props
}: {
  onOpenChange?: unknown;
  open?: unknown;
  [key: string]: unknown;
}) => props;

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
  supportsProfiles: true,
  supportsVariants: true,
  isSelectionCatalogLoading: false,
  agentOptions: [{ value: "builder", label: "Builder" }],
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
  onSelectAgent: noop,
  onSelectModel: noop,
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
  let SessionStartModal: typeof import("./session-start-modal").SessionStartModal;
  let actualAgentRuntimeCombobox: typeof import("./agent-runtime-combobox");
  let actualDialog: typeof import("../../ui/dialog");

  const restoreSessionStartModalMocks = async (): Promise<void> => {
    await restoreMockedModules([
      [
        "@/components/features/agents/agent-runtime-combobox",
        async () => actualAgentRuntimeCombobox,
      ],
      ["@/components/ui/dialog", async () => actualDialog],
    ]);
  };

  beforeEach(async () => {
    actualAgentRuntimeCombobox = await import("./agent-runtime-combobox");
    actualDialog = await import("../../ui/dialog");

    mock.module("@/components/features/agents/agent-runtime-combobox", () => ({
      AgentRuntimeCombobox: (props: Record<string, unknown>) =>
        createElement("agent-runtime-combobox", props),
    }));
    mock.module("@/components/ui/dialog", () => ({
      Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("mock-dialog", omitDialogDomProps(props), children),
      DialogBody: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogDescription: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => createElement("p", omitDialogDomProps(props), children),
      DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("h2", omitDialogDomProps(props), children),
    }));
    ({ SessionStartModal } = await import("./session-start-modal"));
    await restoreSessionStartModalMocks();
  });

  afterEach(async () => {
    await restoreSessionStartModalMocks();
  });

  test("submits through the form action", () => {
    const onConfirm = mock(() => {});
    const { container, unmount } = render(
      createElement(SessionStartModal, { model: createModel({ onConfirm }) }),
    );

    const form = container.querySelector("form");
    if (!form) {
      throw new Error("Expected form element");
    }

    fireEvent.submit(form);

    expect(onConfirm).toHaveBeenCalledWith({
      runInBackground: false,
      startMode: "fresh",
      sourceSessionOptionValue: null,
    });

    expect(screen.getByRole("button", { name: /start session/i })).toBeTruthy();

    unmount();
  });

  test("disables runtime and model selectors when reusing an existing session", () => {
    const { container, unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          availableStartModes: ["fresh", "reuse"],
          selectedStartMode: "reuse",
          existingSessionOptions: [existingSessionOption("session-1")],
          selectedSourceSessionValue: existingSessionOption("session-1").value,
        }),
      }),
    );

    const runtimeCombobox = container.querySelector("agent-runtime-combobox");
    if (!runtimeCombobox) {
      throw new Error("Expected runtime combobox element");
    }
    expect(runtimeCombobox.hasAttribute("disabled")).toBe(true);

    const sourceCombobox = getFieldButton("session-start-source-field");
    const agentCombobox = getFieldButton("session-start-agent-field");
    const modelCombobox = getFieldButton("session-start-model-field");
    const variantCombobox = getFieldButton("session-start-variant-field");

    expect(sourceCombobox.hasAttribute("disabled")).toBe(false);
    expect(agentCombobox.hasAttribute("disabled")).toBe(true);
    expect(modelCombobox.hasAttribute("disabled")).toBe(true);
    expect(variantCombobox.hasAttribute("disabled")).toBe(true);

    unmount();
  });

  test("allows reuse confirm while catalog is loading", () => {
    const onConfirm = mock(() => {});
    const { container, unmount } = render(
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

    const form = container.querySelector("form");
    if (!form) {
      throw new Error("Expected form element");
    }

    fireEvent.submit(form);

    expect(onConfirm).toHaveBeenCalledWith({
      runInBackground: false,
      startMode: "reuse",
      sourceSessionOptionValue: existingSessionOption("session-1").value,
    });

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
      screen.getByText("Reuse mode keeps the previous session agent/model/variant."),
    ).toBeTruthy();
    expect(screen.queryByText("Loading agents for the selected runtime.")).toBeNull();

    unmount();
  });

  test("hides agent selector when the runtime manages profiles", () => {
    const { unmount } = render(
      createElement(SessionStartModal, {
        model: createModel({
          supportsProfiles: false,
          selectedModelSelection: {
            providerId: "openai",
            modelId: "gpt-5.4",
            variant: "default",
          },
          agentOptions: [],
        }),
      }),
    );

    expect(screen.queryByTestId("session-start-agent-field")).toBeNull();
    expect(screen.getByTestId("session-start-model-field")).toBeTruthy();

    unmount();
  });

  test("keeps existing-session selection visible and model controls enabled in fork mode", () => {
    const { container, unmount } = render(
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

    const runtimeCombobox = container.querySelector("agent-runtime-combobox");
    if (!runtimeCombobox) {
      throw new Error("Expected runtime combobox element");
    }
    expect(runtimeCombobox.hasAttribute("disabled")).toBe(false);

    const sourceCombobox = getFieldButton("session-start-source-field");
    const agentCombobox = getFieldButton("session-start-agent-field");
    const modelCombobox = getFieldButton("session-start-model-field");
    const variantCombobox = getFieldButton("session-start-variant-field");

    expect(sourceCombobox.hasAttribute("disabled")).toBe(false);
    expect(agentCombobox.hasAttribute("disabled")).toBe(false);
    expect(modelCombobox.hasAttribute("disabled")).toBe(false);
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

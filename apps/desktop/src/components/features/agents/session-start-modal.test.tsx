import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
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
  selectedSourceSessionId: "",
  onSelectStartMode: noop,
  onSelectSourceSession: noop,
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

describe("SessionStartModal", () => {
  let SessionStartModal: typeof import("./session-start-modal").SessionStartModal;

  beforeAll(async () => {
    mock.module("@/components/features/agents/agent-runtime-combobox", () => ({
      AgentRuntimeCombobox: (props: Record<string, unknown>) =>
        createElement("agent-runtime-combobox", props),
    }));
    mock.module("@/components/ui/combobox", () => ({
      Combobox: (props: Record<string, unknown>) => createElement("mock-combobox", props),
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
  });

  afterAll(() => {
    mock.restore();
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
      sourceSessionId: null,
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
          existingSessionOptions: [{ value: "session-1", label: "Session #1" }],
          selectedSourceSessionId: "session-1",
        }),
      }),
    );

    const runtimeCombobox = container.querySelector("agent-runtime-combobox");
    if (!runtimeCombobox) {
      throw new Error("Expected runtime combobox element");
    }
    expect(runtimeCombobox.hasAttribute("disabled")).toBe(true);

    const allComboboxes = container.querySelectorAll("mock-combobox");
    expect(allComboboxes.length).toBeGreaterThanOrEqual(4);

    const sourceCombobox = allComboboxes[0];
    const agentCombobox = allComboboxes[1];
    const modelCombobox = allComboboxes[2];
    const variantCombobox = allComboboxes[3];

    if (!sourceCombobox || !agentCombobox || !modelCombobox || !variantCombobox) {
      throw new Error("Expected existing session + agent/model/variant comboboxes");
    }

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
          existingSessionOptions: [{ value: "session-1", label: "Session #1" }],
          selectedSourceSessionId: "session-1",
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
      sourceSessionId: "session-1",
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
          existingSessionOptions: [{ value: "session-1", label: "Session #1" }],
          selectedSourceSessionId: "session-1",
        }),
      }),
    );

    expect(
      screen.getByText("Reuse mode keeps the previous session agent/model/variant."),
    ).toBeTruthy();
    expect(screen.queryByText("Loading agents for the selected runtime.")).toBeNull();

    unmount();
  });
});

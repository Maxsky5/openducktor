import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const omitDialogDomProps = ({
  onOpenChange: _onOpenChange,
  open: _open,
  ...props
}: {
  onOpenChange?: unknown;
  open?: unknown;
  [key: string]: unknown;
}) => props;

describe("SettingsModal", () => {
  let SettingsModal: typeof import("./settings-modal").SettingsModal;

  beforeAll(async () => {
    mock.module("./use-settings-modal-controller", () => ({
      useSettingsModalController: () => ({
        isLoadingSettings: false,
        isSaving: false,
        settingsSectionErrorCountById: {},
        markRepoScriptSaveAttempt: () => {},
        submit: async () => false,
        hasPromptValidationErrors: false,
        hasRepoScriptValidationErrors: false,
        settingsError: null,
        saveError: null,
        runtimeDefinitionsError: null,
        promptValidationState: null,
        repoScriptValidationErrorCount: 0,
        snapshotDraft: null,
      }),
    }));
    mock.module("./settings-modal-content", () => ({
      SettingsModalContent: () => createElement("div", null, "Mock settings content"),
    }));
    mock.module("./settings-modal-footer", () => ({
      SettingsModalFooter: () => createElement("div", null, "Mock settings footer"),
    }));
    mock.module("./settings-modal-sidebars", () => ({
      SettingsSidebar: () => createElement("div", null, "Mock settings sidebar"),
    }));
    mock.module("@/components/ui/dialog", () => ({
      Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("mock-dialog", omitDialogDomProps(props), children),
      DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogDescription: ({ children }: { children: ReactNode }) =>
        createElement("p", null, children),
      DialogHeader: ({ children }: { children: ReactNode }) => createElement("div", null, children),
      DialogTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
      DialogTrigger: ({ children }: { children: ReactNode }) =>
        createElement("div", null, children),
    }));
    ({ SettingsModal } = await import("./settings-modal"));
  });

  afterAll(async () => {
    await restoreMockedModules([
      ["./use-settings-modal-controller", () => import("./use-settings-modal-controller")],
      ["./settings-modal-content", () => import("./settings-modal-content")],
      ["./settings-modal-footer", () => import("./settings-modal-footer")],
      ["./settings-modal-sidebars", () => import("./settings-modal-sidebars")],
      ["@/components/ui/dialog", () => import("@/components/ui/dialog")],
    ]);
  });

  test("mounts without crashing and renders the trigger", () => {
    const { unmount } = render(<SettingsModal />);

    expect(screen.getByRole("button", { name: /settings/i })).toBeTruthy();
    expect(screen.getByText("Mock settings content")).toBeTruthy();

    unmount();
  });
});

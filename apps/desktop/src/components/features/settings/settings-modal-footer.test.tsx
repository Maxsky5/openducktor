import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsModalFooter } from "./settings-modal-footer";

enableReactActEnvironment();

const renderFooter = (overrides: Partial<Parameters<typeof SettingsModalFooter>[0]> = {}) => {
  return render(
    createElement(SettingsModalFooter, {
      isSaving: false,
      isLoadingSettings: false,
      hasPromptValidationErrors: false,
      hasRepoScriptValidationErrors: false,
      settingsError: null,
      saveError: null,
      catalogError: null,
      section: "repositories",
      repositorySection: "configuration",
      promptValidationState: {
        globalErrors: {},
        globalErrorCount: 0,
        repoErrorsByPath: {},
        repoErrorCountByPath: {},
        repoTotalErrorCount: 0,
        totalErrorCount: 0,
      },
      repoScriptValidationErrorCount: 0,
      hasSnapshotDraft: true,
      onCancel: () => {},
      onSave: () => {},
      ...overrides,
    }),
  );
};

describe("SettingsModalFooter", () => {
  test("keeps save enabled when only dev server fields are invalid", () => {
    const renderer = renderFooter({
      hasRepoScriptValidationErrors: true,
      repoScriptValidationErrorCount: 2,
    });

    try {
      expect(screen.getByRole("button", { name: /save settings/i }).hasAttribute("disabled")).toBe(
        false,
      );
    } finally {
      renderer.unmount();
    }
  });

  test("shows the dev server validation count in the footer", () => {
    const renderer = renderFooter({
      hasRepoScriptValidationErrors: true,
      repoScriptValidationErrorCount: 2,
    });

    try {
      expect(screen.getByText(/2 dev server field errors\./i)).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });
});

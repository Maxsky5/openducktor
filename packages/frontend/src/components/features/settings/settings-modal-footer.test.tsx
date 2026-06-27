import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsModalFooter } from "./settings-modal-footer";

enableReactActEnvironment();

const renderFooter = (overrides: Partial<Parameters<typeof SettingsModalFooter>[0]> = {}) => {
  return render(
    createElement(SettingsModalFooter, {
      saveState: {
        isSaving: false,
        isLoadingSettings: false,
        hasSnapshotDraft: true,
        settingsError: null,
      },
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 0,
      },
      errors: { saveError: null, catalogError: null },
      location: { section: "repositories", repositorySection: "configuration" },
      onCancel: () => {},
      onSave: () => {},
      ...overrides,
    }),
  );
};

describe("SettingsModalFooter", () => {
  test("keeps save enabled when only dev server fields are invalid", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 2,
      },
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
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 2,
      },
    });

    try {
      expect(screen.getByText(/2 dev server field errors\./i)).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("disables save when reusable prompt fields are invalid", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        reusablePromptFieldErrorCount: 1,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 0,
      },
    });

    try {
      expect(screen.getByRole("button", { name: /save settings/i }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByText(/1 reusable prompt field error\./i)).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("disables save and shows runtime availability count", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 2,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 0,
      },
    });

    try {
      expect(screen.getByRole("button", { name: /save settings/i }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByText(/2 disabled runtime selections\./i)).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("disables save when dangerous Codex settings are unacknowledged", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: true,
        repoScriptFieldErrorCount: 0,
      },
    });

    try {
      expect(screen.getByRole("button", { name: /save settings/i }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByText(/Codex acknowledgement required\./i)).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });
});

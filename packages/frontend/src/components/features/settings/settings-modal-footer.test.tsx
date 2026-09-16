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
        isLoadingRuntimeConfiguration: false,
      },
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        customAgentRoleFieldErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 0,
      },
      errors: { saveError: null, catalogError: null, runtimeExecutablesError: null },
      location: { section: "repositories", repositorySection: "configuration" },
      onCancel: () => {},
      onSave: () => {},
      ...overrides,
    }),
  );
};

describe("SettingsModalFooter", () => {
  test.each([null, "Save failed"])(
    "preserves message priority and independent query errors with save error %s",
    (saveError) => {
      const renderer = renderFooter({
        location: { section: "runtimes", repositorySection: "configuration" },
        validationSummary: {
          promptPlaceholderErrorCount: 1,
          customAgentRoleFieldErrorCount: 2,
          reusablePromptFieldErrorCount: 3,
          runtimeAvailabilityErrorCount: 4,
          hasUnacknowledgedCodexDangerousSettings: true,
          repoScriptFieldErrorCount: 5,
        },
        errors: {
          saveError,
          catalogError: "Catalog unavailable",
          runtimeExecutablesError: "Check failed",
        },
      });
      try {
        expect(
          screen.getByText("Runtime definitions unavailable: Catalog unavailable"),
        ).toBeTruthy();
        expect(screen.getByText("Runtime executable check failed: Check failed")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Save Settings" }).hasAttribute("disabled")).toBe(
          true,
        );
        if (saveError) {
          expect(screen.getByText(saveError)).toBeTruthy();
          expect(screen.queryByText("2 custom role field errors.")).toBeNull();
          expect(screen.queryByText("1 prompt placeholder error.")).toBeNull();
        } else {
          expect(screen.getByText("2 custom role field errors.")).toBeTruthy();
          expect(screen.getByText("1 prompt placeholder error.")).toBeTruthy();
        }
        expect(screen.queryByText("3 reusable prompt field errors.")).toBeNull();
        expect(screen.queryByText("5 dev server field errors.")).toBeNull();
      } finally {
        renderer.unmount();
      }
    },
  );

  test("disables save and shows custom role field errors", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        customAgentRoleFieldErrorCount: 2,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScriptFieldErrorCount: 0,
      },
    });
    try {
      expect(screen.getByRole("button", { name: "Save Settings" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByText("2 custom role field errors.")).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("uses the same save and cancel controls for custom roles", () => {
    const renderer = renderFooter({
      location: { section: "custom-agent-roles", repositorySection: "configuration" },
    });
    try {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save Settings" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Save other settings" })).toBeNull();
    } finally {
      renderer.unmount();
    }
  });
  test("keeps save enabled when only dev server fields are invalid", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        customAgentRoleFieldErrorCount: 0,
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
        customAgentRoleFieldErrorCount: 0,
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
        customAgentRoleFieldErrorCount: 0,
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

  test("disables save and shows runtime executable error count", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        customAgentRoleFieldErrorCount: 0,
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
      expect(screen.getByText(/2 runtime executable errors\./i)).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("disables save when dangerous Codex settings are unacknowledged", () => {
    const renderer = renderFooter({
      validationSummary: {
        promptPlaceholderErrorCount: 0,
        customAgentRoleFieldErrorCount: 0,
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
      expect(
        screen.getByText(/Confirm the Codex safety acknowledgement before saving\./i),
      ).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("disables save while runtime configuration requests are pending", () => {
    const renderer = renderFooter({
      saveState: {
        isSaving: false,
        isLoadingSettings: false,
        hasSnapshotDraft: true,
        settingsError: null,
        isLoadingRuntimeConfiguration: true,
      },
    });

    try {
      expect(screen.getByRole("button", { name: /save settings/i }).hasAttribute("disabled")).toBe(
        true,
      );
    } finally {
      renderer.unmount();
    }
  });

  test("disables save and shows runtime request errors", () => {
    const renderer = renderFooter({
      errors: {
        saveError: null,
        catalogError: "Definitions failed",
        runtimeExecutablesError: "Executable check failed",
      },
      location: { section: "runtimes", repositorySection: "configuration" },
    });

    try {
      expect(screen.getByRole("button", { name: /save settings/i }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByText(/Runtime definitions unavailable: Definitions failed/i)).toBeTruthy();
      expect(
        screen.getByText(/Runtime executable check failed: Executable check failed/i),
      ).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("keeps multiline save failures readable", () => {
    const renderer = renderFooter({
      errors: {
        saveError: 'theme: Invalid option (found "blue")\ntags: Too small (found array)',
        catalogError: null,
        runtimeExecutablesError: null,
      },
    });

    try {
      const message = screen.getByText(/theme: Invalid option/);
      expect(message.textContent).toContain("\n");
      expect(message.className).toContain("whitespace-pre-wrap");
      expect(message.className).toContain("break-words");
    } finally {
      renderer.unmount();
    }
  });
});

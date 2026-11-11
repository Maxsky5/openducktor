import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
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
        openCodePermissionErrorCount: 0,
        promptPlaceholderErrorCount: 0,
        promptPlaceholderErrorPlace: null,
        customAgentRoleFieldErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
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
  test("names the place of the first prompt placeholder error, so the user can find it", () => {
    const base = {
      openCodePermissionErrorCount: 0,
      customAgentRoleFieldErrorCount: 0,
      reusablePromptFieldErrorCount: 0,
      runtimeAvailabilityErrorCount: 0,
      hasUnacknowledgedCodexDangerousSettings: false,
      promptPlaceholderErrorPlace: "Fix Kickoff (Bug Triage, System prompts)",
    };
    const one = renderFooter({
      validationSummary: { ...base, promptPlaceholderErrorCount: 1 },
    });
    try {
      expect(
        screen.getByText("Fix the placeholder error in Fix Kickoff (Bug Triage, System prompts)."),
      ).toBeTruthy();
    } finally {
      one.unmount();
    }
    const two = renderFooter({
      validationSummary: { ...base, promptPlaceholderErrorCount: 2 },
    });
    try {
      expect(
        screen.getByText(
          "Fix 2 prompt placeholder errors. The first is in Fix Kickoff (Bug Triage, System prompts).",
        ),
      ).toBeTruthy();
    } finally {
      two.unmount();
    }
  });

  test("closes remote control without offering an unrelated settings save", () => {
    const close = mock(() => {});
    const save = mock(() => {});
    const view = renderFooter({
      location: { section: "remote-access", repositorySection: "configuration" },
      onCancel: close,
      onSave: save,
    });
    try {
      expect(screen.queryByRole("button", { name: /save settings/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(close).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
  test.each([null, "Save failed"])(
    "preserves message priority and independent query errors with save error %s",
    (saveError) => {
      const renderer = renderFooter({
        location: { section: "runtimes", repositorySection: "configuration" },
        validationSummary: {
          openCodePermissionErrorCount: 0,
          promptPlaceholderErrorCount: 1,
          promptPlaceholderErrorPlace: null,
          customAgentRoleFieldErrorCount: 2,
          reusablePromptFieldErrorCount: 3,
          runtimeAvailabilityErrorCount: 4,
          hasUnacknowledgedCodexDangerousSettings: true,
        },
        errors: {
          saveError,
          catalogError: "Catalog unavailable",
          runtimeExecutablesError: "Check failed",
        },
      });
      try {
        expect(screen.getByText("Could not load runtimes: Catalog unavailable")).toBeTruthy();
        expect(screen.getByText("Runtime executable check failed: Check failed")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
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
      } finally {
        renderer.unmount();
      }
    },
  );

  test("disables save and shows custom role field errors", () => {
    const renderer = renderFooter({
      validationSummary: {
        openCodePermissionErrorCount: 0,
        promptPlaceholderErrorCount: 0,
        promptPlaceholderErrorPlace: null,
        customAgentRoleFieldErrorCount: 2,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
      },
    });
    try {
      expect(screen.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByText("2 custom role field errors.")).toBeTruthy();
    } finally {
      renderer.unmount();
    }
  });

  test("keeps Cancel left and Save settings right", () => {
    const renderer = renderFooter();
    try {
      const cancel = screen.getByRole("button", { name: "Cancel" });
      const save = screen.getByRole("button", { name: "Save settings" });
      const footer = cancel.closest('[data-slot="dialog-footer"]');
      expect(footer).not.toBeNull();
      expect(save.closest('[data-slot="dialog-footer"]')).toBe(footer);
      expect(footer?.classList.contains("justify-between")).toBe(true);
      expect(footer?.classList.contains("justify-start")).toBe(false);
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
      expect(screen.getByRole("button", { name: "Save settings" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Save other settings" })).toBeNull();
    } finally {
      renderer.unmount();
    }
  });
  test("disables save when reusable prompt fields are invalid", () => {
    const renderer = renderFooter({
      validationSummary: {
        openCodePermissionErrorCount: 0,
        promptPlaceholderErrorCount: 0,
        promptPlaceholderErrorPlace: null,
        customAgentRoleFieldErrorCount: 0,
        reusablePromptFieldErrorCount: 1,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: false,
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
        openCodePermissionErrorCount: 0,
        promptPlaceholderErrorCount: 0,
        promptPlaceholderErrorPlace: null,
        customAgentRoleFieldErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 2,
        hasUnacknowledgedCodexDangerousSettings: false,
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
        openCodePermissionErrorCount: 0,
        promptPlaceholderErrorCount: 0,
        promptPlaceholderErrorPlace: null,
        customAgentRoleFieldErrorCount: 0,
        reusablePromptFieldErrorCount: 0,
        runtimeAvailabilityErrorCount: 0,
        hasUnacknowledgedCodexDangerousSettings: true,
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
      expect(screen.getByText(/Could not load runtimes: Definitions failed/i)).toBeTruthy();
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

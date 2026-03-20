import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsModalFooter } from "./settings-modal-footer";

enableReactActEnvironment();

const renderFooter = (overrides: Partial<Parameters<typeof SettingsModalFooter>[0]> = {}) => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
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
  });
  return renderer;
};

describe("SettingsModalFooter", () => {
  test("keeps save enabled when only dev server fields are invalid", () => {
    const renderer = renderFooter({
      hasRepoScriptValidationErrors: true,
      repoScriptValidationErrorCount: 2,
    });

    try {
      const buttons = renderer.root.findAllByType("button");
      const saveButton = buttons.find((button) => button.props.children === "Save Settings");
      expect(saveButton?.props.disabled).toBe(false);
    } finally {
      act(() => {
        renderer.unmount();
      });
    }
  });

  test("shows the dev server validation count in the footer", () => {
    const renderer = renderFooter({
      hasRepoScriptValidationErrors: true,
      repoScriptValidationErrorCount: 2,
    });

    try {
      const spans = renderer.root.findAllByType("span");
      const textContent = spans
        .flatMap((span) =>
          Array.isArray(span.props.children) ? span.props.children : [span.props.children],
        )
        .filter(
          (value): value is string | number =>
            (typeof value === "string" && value.length > 0) || typeof value === "number",
        )
        .map((value) => String(value))
        .join("");
      expect(textContent).toContain("2 dev server field errors.");
    } finally {
      act(() => {
        renderer.unmount();
      });
    }
  });
});

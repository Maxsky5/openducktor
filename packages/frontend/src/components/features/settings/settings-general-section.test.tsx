import { describe, expect, test } from "bun:test";
import type { GeneralSettings } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GeneralSettingsSection } from "./settings-general-section";

const renderSection = (general: GeneralSettings, disabled = false): string =>
  renderToStaticMarkup(
    createElement(GeneralSettingsSection, {
      general,
      disabled,
      onUpdateGeneral: () => general,
    }),
  );

describe("settings general section", () => {
  test("renders background Agent Studio tab setting copy", () => {
    const html = renderSection({ openAgentStudioTabOnBackgroundSessionStart: true });

    expect(html).toContain("General Settings");
    expect(html).toContain("Open Agent Studio tab for background sessions");
    expect(html).toContain("without navigating away from Kanban");
  });

  test("renders switch as checked when enabled", () => {
    const html = renderSection({ openAgentStudioTabOnBackgroundSessionStart: true });

    expect(html).toContain('aria-checked="true"');
  });

  test("renders switch as unchecked when disabled", () => {
    const html = renderSection({ openAgentStudioTabOnBackgroundSessionStart: false });

    expect(html).toContain('aria-checked="false"');
  });

  test("switch is disabled while interactions are disabled", () => {
    const html = renderSection({ openAgentStudioTabOnBackgroundSessionStart: true }, true);

    expect(html).toContain("disabled");
  });
});

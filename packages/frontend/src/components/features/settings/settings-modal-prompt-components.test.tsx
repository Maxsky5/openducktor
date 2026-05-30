import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptOverrideCard, PromptRoleTabs } from "./settings-modal-prompt-components";

const noop = () => undefined;

describe("PromptOverrideCard", () => {
  test("renders the inherited prompt in the editor when no override exists", () => {
    const markup = renderToStaticMarkup(
      <PromptOverrideCard
        label="Spec kickoff"
        description="Prompt used to start spec sessions."
        inheritedPreview={{ sourceLabel: "Builtin prompt", template: "builtin prompt" }}
        disabled={false}
        canClearOverride={false}
        onToggleEnabled={noop}
        onTemplateChange={noop}
        onClearOverride={noop}
      />,
    );

    expect(markup).toContain("builtin prompt");
    expect(markup).toContain("Clear override");
    expect(markup).toContain(">builtin prompt</textarea>");
  });

  test("renders the stored override value in the editor", () => {
    const markup = renderToStaticMarkup(
      <PromptOverrideCard
        label="Spec kickoff"
        description="Prompt used to start spec sessions."
        override={{ template: "reusable prompt", baseVersion: 2, enabled: true }}
        disabled={false}
        canClearOverride
        onToggleEnabled={noop}
        onTemplateChange={noop}
        onClearOverride={noop}
      />,
    );

    expect(markup).toContain(">reusable prompt</textarea>");
  });
});

describe("PromptRoleTabs", () => {
  test("renders active role and placeholder error status", () => {
    const markup = renderToStaticMarkup(
      <PromptRoleTabs
        value="spec"
        disabled={false}
        errorCounts={{ shared: 0, spec: 1, planner: 0, build: 0, qa: 0 }}
        onChange={noop}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Spec");
    expect(markup).toContain("1 prompt placeholder error");
  });
});

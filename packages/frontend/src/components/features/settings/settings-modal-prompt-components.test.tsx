import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptOverrideCard } from "./settings-modal-prompt-components";

const noop = () => undefined;

describe("PromptOverrideCard", () => {
  test("renders an empty editor when only an inherited prompt is available", () => {
    const markup = renderToStaticMarkup(
      <PromptOverrideCard
        label="Spec kickoff"
        description="Prompt used to start spec sessions."
        inheritedPreview={{ sourceLabel: "Builtin prompt", template: "builtin prompt" }}
        disabled={false}
        canResetToBuiltin={false}
        onToggleEnabled={noop}
        onTemplateChange={noop}
        onResetToBuiltin={noop}
      />,
    );

    expect(markup).toContain("builtin prompt");
    expect(markup).toContain("Clear override");
    expect(markup).toMatch(/<textarea[^>]*><\/textarea>/);
  });

  test("renders the stored override value in the editor", () => {
    const markup = renderToStaticMarkup(
      <PromptOverrideCard
        label="Spec kickoff"
        description="Prompt used to start spec sessions."
        override={{ template: "custom prompt", baseVersion: 2, enabled: true }}
        disabled={false}
        canResetToBuiltin
        onToggleEnabled={noop}
        onTemplateChange={noop}
        onResetToBuiltin={noop}
      />,
    );

    expect(markup).toContain(">custom prompt</textarea>");
  });
});

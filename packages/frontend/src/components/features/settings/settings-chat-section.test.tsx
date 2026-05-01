import { describe, expect, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsChatSection } from "./settings-chat-section";

describe("settings chat section", () => {
  const emptyValidationErrors = {};

  test("renders chat settings with thinking messages hidden by default", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false, customPrompts: [] };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        validationErrors: emptyValidationErrors,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("Chat Settings");
    expect(html).toContain("Show Thinking Messages");
    expect(html).toContain("Thinking messages are hidden by default");
    expect(html).toContain("Agent Studio transcript");
  });

  test("renders switch as unchecked when showThinkingMessages is false", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false, customPrompts: [] };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        validationErrors: emptyValidationErrors,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain('aria-checked="false"');
  });

  test("renders switch as checked when showThinkingMessages is true", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: true, customPrompts: [] };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        validationErrors: emptyValidationErrors,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain('aria-checked="true"');
  });

  test("switch is disabled when disabled prop is true", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false, customPrompts: [] };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        validationErrors: emptyValidationErrors,
        disabled: true,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("disabled");
  });

  test("displays save notice about changes taking effect after save", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false, customPrompts: [] };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        validationErrors: emptyValidationErrors,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("after you save settings");
  });

  test("renders saved custom prompts and validation errors", () => {
    const chatSettings: ChatSettings = {
      showThinkingMessages: false,
      customPrompts: [
        {
          id: "prompt-1",
          name: "review",
          description: "Review files",
          content: "Review this:\n$ARGUMENTS",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        validationErrors: { "prompt-1": { content: "Prompt content is required." } },
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("Custom prompts");
    expect(html).toContain("review");
    expect(html).toContain("Review files");
    expect(html).toContain("Prompt content is required.");
  });
});

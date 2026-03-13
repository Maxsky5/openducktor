import { describe, expect, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsChatSection } from "./settings-chat-section";

describe("settings chat section", () => {
  test("renders chat settings with thinking messages hidden by default", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
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
    const chatSettings: ChatSettings = { showThinkingMessages: false };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain('aria-checked="false"');
  });

  test("renders switch as checked when showThinkingMessages is true", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: true };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain('aria-checked="true"');
  });

  test("switch is disabled when disabled prop is true", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: true,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("disabled");
  });

  test("displays save notice about changes taking effect after save", () => {
    const chatSettings: ChatSettings = { showThinkingMessages: false };

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("after you save settings");
  });
});

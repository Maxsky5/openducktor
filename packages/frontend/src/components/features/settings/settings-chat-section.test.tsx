import { describe, expect, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsChatSection } from "./settings-chat-section";

const createChatSettings = (overrides: Partial<ChatSettings> = {}): ChatSettings => ({
  showThinkingMessages: false,
  expandFileDiffsByDefault: true,
  ...overrides,
});

const switchHasCheckedState = (html: string, label: string, checked: boolean): boolean => {
  const switchTag = (html.match(/<button[^>]*aria-label="[^"]+"[^>]*>/g) ?? []).find((tag) =>
    tag.includes(`aria-label="${label}"`),
  );
  return switchTag?.includes(`aria-checked="${checked ? "true" : "false"}"`) ?? false;
};

describe("settings chat section", () => {
  test("renders chat settings with thinking messages hidden by default", () => {
    const chatSettings = createChatSettings();

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
    expect(html).toContain("Expand file diffs by default");
    expect(html).toContain("File diffs in Agent Studio transcripts will start expanded");
  });

  test("renders switch as unchecked when showThinkingMessages is false", () => {
    const chatSettings = createChatSettings({ showThinkingMessages: false });

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(
      switchHasCheckedState(html, "Show thinking messages in Agent Studio transcript", false),
    ).toBe(true);
  });

  test("renders switch as checked when showThinkingMessages is true", () => {
    const chatSettings = createChatSettings({ showThinkingMessages: true });

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(
      switchHasCheckedState(html, "Show thinking messages in Agent Studio transcript", true),
    ).toBe(true);
  });

  test("renders file diff switch as checked when diffs expand by default", () => {
    const chatSettings = createChatSettings({ expandFileDiffsByDefault: true });

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(
      switchHasCheckedState(html, "Expand file diffs by default in Agent Studio transcripts", true),
    ).toBe(true);
  });

  test("renders file diff switch as unchecked when diffs start collapsed", () => {
    const chatSettings = createChatSettings({ expandFileDiffsByDefault: false });

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(
      switchHasCheckedState(
        html,
        "Expand file diffs by default in Agent Studio transcripts",
        false,
      ),
    ).toBe(true);
  });

  test("switch is disabled when disabled prop is true", () => {
    const chatSettings = createChatSettings();

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: true,
        onUpdateChat: () => chatSettings,
      }),
    );

    const switchTags = html.match(/<button[^>]*aria-label="[^"]+"[^>]*>/g) ?? [];
    expect(switchTags).toHaveLength(2);
    expect(switchTags.every((tag) => tag.includes("disabled"))).toBe(true);
  });

  test("displays save notice about changes taking effect after save", () => {
    const chatSettings = createChatSettings();

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).toContain("after you save settings");
  });

  test("does not render reusable prompts in chat settings", () => {
    const chatSettings = createChatSettings();

    const html = renderToStaticMarkup(
      createElement(SettingsChatSection, {
        chat: chatSettings,
        disabled: false,
        onUpdateChat: () => chatSettings,
      }),
    );

    expect(html).not.toContain("Reusable prompts");
    expect(html).not.toContain("review");
  });
});

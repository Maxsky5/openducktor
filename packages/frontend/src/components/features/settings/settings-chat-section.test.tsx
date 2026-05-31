import { afterEach, describe, expect, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsChatSection } from "./settings-chat-section";

const createChatSettings = (overrides: Partial<ChatSettings> = {}): ChatSettings => ({
  showThinkingMessages: false,
  expandFileDiffsByDefault: true,
  ...overrides,
});

const renderSettingsChatSection = (chat: ChatSettings, disabled = false): void => {
  render(<SettingsChatSection chat={chat} disabled={disabled} onUpdateChat={() => chat} />);
};

const expectSwitchChecked = (name: string, checked: boolean): void => {
  expect(screen.getByRole("switch", { name }).getAttribute("aria-checked")).toBe(
    checked ? "true" : "false",
  );
};

afterEach(() => {
  cleanup();
});

describe("settings chat section", () => {
  test("renders chat settings with thinking messages hidden by default", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expect(screen.getByText("Chat Settings")).toBeDefined();
    expect(screen.getByText("Show Thinking Messages")).toBeDefined();
    expect(screen.getByText(/Thinking messages are hidden by default/)).toBeDefined();
    expect(
      screen.getByText(
        "Thinking messages are hidden by default. When enabled, they will appear in the Agent Studio transcript after you save settings.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Expand file diffs by default")).toBeDefined();
    expect(
      screen.getByText(/File diffs in Agent Studio transcripts will start expanded/),
    ).toBeDefined();
  });

  test("renders switch as unchecked when showThinkingMessages is false", () => {
    const chatSettings = createChatSettings({ showThinkingMessages: false });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Show thinking messages in Agent Studio transcript", false);
  });

  test("renders switch as checked when showThinkingMessages is true", () => {
    const chatSettings = createChatSettings({ showThinkingMessages: true });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Show thinking messages in Agent Studio transcript", true);
  });

  test("renders file diff switch as checked when diffs expand by default", () => {
    const chatSettings = createChatSettings({ expandFileDiffsByDefault: true });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Expand file diffs by default in Agent Studio transcripts", true);
  });

  test("renders file diff switch as unchecked when diffs start collapsed", () => {
    const chatSettings = createChatSettings({ expandFileDiffsByDefault: false });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Expand file diffs by default in Agent Studio transcripts", false);
  });

  test("switch is disabled when disabled prop is true", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings, true);

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(switches.every((control) => control.hasAttribute("disabled"))).toBe(true);
  });

  test("displays save notice about changes taking effect after save", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expect(
      screen.getByText("Changes to chat settings will take effect after you save your settings."),
    ).toBeDefined();
  });

  test("does not render reusable prompts in chat settings", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expect(screen.queryByText("Reusable prompts")).toBeNull();
    expect(screen.queryByText("review")).toBeNull();
  });
});

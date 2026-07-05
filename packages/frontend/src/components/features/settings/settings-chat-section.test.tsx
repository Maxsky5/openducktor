import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { SettingsChatSection } from "./settings-chat-section";

const createChatSettings = (overrides: Partial<ChatSettings> = {}): ChatSettings =>
  createChatSettingsFixture(overrides);

const renderSettingsChatSection = (chat: ChatSettings, disabled = false): void => {
  render(<SettingsChatSection chat={chat} disabled={disabled} onUpdateChat={() => chat} />);
};

const renderSettingsChatSectionWithUpdates = (chat: ChatSettings) => {
  let latestChat = chat;
  const onUpdateChat = mock((updater: (current: ChatSettings) => ChatSettings): void => {
    latestChat = updater(latestChat);
  });

  render(<SettingsChatSection chat={chat} disabled={false} onUpdateChat={onUpdateChat} />);

  return {
    onUpdateChat,
    getLatestChat: () => latestChat,
  };
};

const expectSwitchChecked = (name: string, checked: boolean): void => {
  expect(screen.getByRole("switch", { name }).getAttribute("aria-checked")).toBe(
    checked ? "true" : "false",
  );
};

const expectSegmentedOptions = (name: string, values: string[]): void => {
  const group = screen.getByRole("group", { name });
  expect(
    within(group)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(values);
};

const clickSegmentedOption = (name: string, value: string): void => {
  fireEvent.click(within(screen.getByRole("group", { name })).getByRole("button", { name: value }));
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
    expect(screen.getByText("Diff Style")).toBeDefined();
    expect(screen.getByText("Diff Indicators")).toBeDefined();
    expect(screen.getByText("Diff Height")).toBeDefined();
    expect(screen.getByText("Line Overflow")).toBeDefined();
    expect(screen.getByText("Hunk Separators")).toBeDefined();
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

  test("renders every transcript diff setting option", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expectSegmentedOptions("Diff Style", ["split", "unified"]);
    expectSegmentedOptions("Diff Indicators", ["bars", "classic", "none"]);
    expectSegmentedOptions("Diff Height", ["full", "scroll"]);
    expectSegmentedOptions("Line Overflow", ["wrap", "scroll"]);
    expectSegmentedOptions("Hunk Separators", [
      "line-info",
      "line-info-basic",
      "metadata",
      "simple",
    ]);
  });

  test("marks saved transcript diff setting values as active", () => {
    const chatSettings = createChatSettings({
      diffStyle: "unified",
      diffIndicators: "none",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "simple",
    });

    renderSettingsChatSection(chatSettings);

    expect(
      within(screen.getByRole("group", { name: "Diff Style" }))
        .getByRole("button", { name: "unified" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Diff Indicators" }))
        .getByRole("button", { name: "none" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Diff Height" }))
        .getByRole("button", { name: "scroll" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Line Overflow" }))
        .getByRole("button", { name: "scroll" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Hunk Separators" }))
        .getByRole("button", { name: "simple" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("segmented diff setting controls are disabled when disabled prop is true", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings, true);

    const optionButtons = screen.getAllByRole("button");
    expect(optionButtons).toHaveLength(13);
    expect(optionButtons.every((control) => control.hasAttribute("disabled"))).toBe(true);
  });

  test("updates transcript diff settings without dropping unrelated chat settings", () => {
    const chatSettings = createChatSettings({
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
    });
    const { getLatestChat, onUpdateChat } = renderSettingsChatSectionWithUpdates(chatSettings);

    clickSegmentedOption("Diff Style", "unified");
    clickSegmentedOption("Diff Indicators", "classic");
    clickSegmentedOption("Diff Height", "scroll");
    clickSegmentedOption("Line Overflow", "scroll");
    clickSegmentedOption("Hunk Separators", "metadata");

    expect(onUpdateChat).toHaveBeenCalledTimes(5);
    expect(getLatestChat()).toEqual({
      ...chatSettings,
      diffStyle: "unified",
      diffIndicators: "classic",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "metadata",
    });
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

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

const expectSegmentedOptions = (name: string, labels: string[]): void => {
  const group = screen.getByRole("group", { name });
  expect(
    within(group)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(labels);
};

const clickSegmentedOption = (name: string, label: string): void => {
  fireEvent.click(within(screen.getByRole("group", { name })).getByRole("button", { name: label }));
};

afterEach(() => {
  cleanup();
});

describe("settings chat section", () => {
  test("edits default steering in the draft and retains the other chat preferences", () => {
    const chat = createChatSettings({ showThinkingMessages: true });
    const { getLatestChat } = renderSettingsChatSectionWithUpdates(chat);
    expectSwitchChecked("Steer messages by default", false);
    fireEvent.click(screen.getByRole("switch", { name: "Steer messages by default" }));
    expect(getLatestChat()).toEqual({ ...chat, steerMessagesByDefault: true });
    expect(chat.steerMessagesByDefault).toBe(false);
  });
  test("renders chat settings with thinking messages hidden by default", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expect(screen.getByText("Session settings")).toBeDefined();
    expect(screen.getByText("Show thinking messages")).toBeDefined();
    expect(screen.getByText(/Thinking messages are hidden by default/)).toBeDefined();
    expect(
      screen.getByText(
        "Thinking messages are hidden by default. When enabled, they will appear in session transcripts after you save settings.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Expand file diffs by default")).toBeDefined();
    expect(screen.getByText(/File diffs in session transcripts will start expanded/)).toBeDefined();
    expect(screen.getByText("Diff style")).toBeDefined();
    expect(screen.getByText("Diff indicators")).toBeDefined();
    expect(screen.getByText("Diff height")).toBeDefined();
    expect(screen.getByText("Line overflow")).toBeDefined();
    expect(screen.getByText("Hunk separators")).toBeDefined();
  });

  test("renders switch as unchecked when showThinkingMessages is false", () => {
    const chatSettings = createChatSettings({ showThinkingMessages: false });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Show thinking messages in session transcripts", false);
  });

  test("renders switch as checked when showThinkingMessages is true", () => {
    const chatSettings = createChatSettings({ showThinkingMessages: true });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Show thinking messages in session transcripts", true);
  });

  test("edits the conversation minimap switch in the draft", () => {
    const chat = createChatSettings();
    const { getLatestChat } = renderSettingsChatSectionWithUpdates(chat);

    expect(screen.getByText("Show conversation minimap")).toBeDefined();
    expect(
      screen.getByText(
        "Shows your messages beside session transcripts. Changes apply after you save settings.",
      ),
    ).toBeDefined();
    expectSwitchChecked("Show conversation minimap beside session transcripts", true);
    fireEvent.click(
      screen.getByRole("switch", { name: "Show conversation minimap beside session transcripts" }),
    );
    expect(getLatestChat()).toEqual({ ...chat, showConversationMinimap: false });
  });

  test("edits the tool call grouping switch in the draft", () => {
    const chat = createChatSettings();
    const { getLatestChat } = renderSettingsChatSectionWithUpdates(chat);

    expect(screen.getByText("Group tool calls")).toBeDefined();
    expectSwitchChecked("Group tool calls in session transcripts", true);
    fireEvent.click(
      screen.getByRole("switch", { name: "Group tool calls in session transcripts" }),
    );
    expect(getLatestChat()).toEqual({ ...chat, groupToolCalls: false });
  });

  test("edits the finished tool call collapse switch, which needs grouped tool calls", () => {
    const chat = createChatSettings();
    const { getLatestChat } = renderSettingsChatSectionWithUpdates(chat);

    const name = "Collapse finished tool call groups in session transcripts";
    expectSwitchChecked(name, true);
    fireEvent.click(screen.getByRole("switch", { name }));
    expect(getLatestChat()).toEqual({ ...chat, collapseFinishedToolCalls: false });

    renderSettingsChatSection(createChatSettings({ groupToolCalls: false }));
    expect(screen.getAllByRole("switch", { name }).at(-1)?.hasAttribute("disabled")).toBe(true);
  });

  test("renders file diff switch as checked when diffs expand by default", () => {
    const chatSettings = createChatSettings({ expandFileDiffsByDefault: true });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Expand file diffs by default in session transcripts", true);
  });

  test("renders file diff switch as unchecked when diffs start collapsed", () => {
    const chatSettings = createChatSettings({ expandFileDiffsByDefault: false });

    renderSettingsChatSection(chatSettings);

    expectSwitchChecked("Expand file diffs by default in session transcripts", false);
  });

  test("switch is disabled when disabled prop is true", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings, true);

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(6);
    expect(switches.every((control) => control.hasAttribute("disabled"))).toBe(true);
  });

  test("renders every transcript diff setting option", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expectSegmentedOptions("Diff style", ["Split", "Unified"]);
    expectSegmentedOptions("Diff indicators", ["Bars", "Classic", "None"]);
    expectSegmentedOptions("Diff height", ["Full", "Scroll"]);
    expectSegmentedOptions("Line overflow", ["Wrap", "Scroll"]);
    expectSegmentedOptions("Hunk separators", [
      "Line info",
      "Line info basic",
      "Metadata",
      "Simple",
    ]);
  });

  test("uses wrapping segmented controls for variable option counts", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expect(screen.getByRole("group", { name: "Diff indicators" }).className).toContain("flex-wrap");
    expect(screen.getByRole("group", { name: "Hunk separators" }).className).toContain("flex-wrap");
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
      within(screen.getByRole("group", { name: "Diff style" }))
        .getByRole("button", { name: "Unified" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Diff indicators" }))
        .getByRole("button", { name: "None" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Diff height" }))
        .getByRole("button", { name: "Scroll" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Line overflow" }))
        .getByRole("button", { name: "Scroll" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Hunk separators" }))
        .getByRole("button", { name: "Simple" })
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

  test("does not update chat settings when clicking the active segmented option", () => {
    const chatSettings = createChatSettings();
    const { getLatestChat, onUpdateChat } = renderSettingsChatSectionWithUpdates(chatSettings);

    clickSegmentedOption("Diff style", "Split");

    expect(onUpdateChat).not.toHaveBeenCalled();
    expect(getLatestChat()).toEqual(chatSettings);
  });

  test("updates transcript diff settings without dropping unrelated chat settings", () => {
    const chatSettings = createChatSettings({
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
    });
    const { getLatestChat, onUpdateChat } = renderSettingsChatSectionWithUpdates(chatSettings);

    clickSegmentedOption("Diff style", "Unified");
    clickSegmentedOption("Diff indicators", "Classic");
    clickSegmentedOption("Diff height", "Scroll");
    clickSegmentedOption("Line overflow", "Scroll");
    clickSegmentedOption("Hunk separators", "Metadata");

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
      screen.getByText("Changes to session settings apply after you save your settings."),
    ).toBeDefined();
  });

  test("does not render reusable prompts in chat settings", () => {
    const chatSettings = createChatSettings();

    renderSettingsChatSection(chatSettings);

    expect(screen.queryByText("Reusable prompts")).toBeNull();
    expect(screen.queryByText("review")).toBeNull();
  });
});

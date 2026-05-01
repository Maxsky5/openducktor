import { describe, expect, mock, test } from "bun:test";
import type { ChatSettings } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsCustomPromptsSection } from "./settings-custom-prompts-section";

enableReactActEnvironment();

const CUSTOM_PROMPTS: ChatSettings["customPrompts"] = [
  {
    id: "prompt-1",
    name: "review",
    description: "Review files",
    content: "Review this:\n$ARGUMENTS",
  },
];

describe("SettingsCustomPromptsSection", () => {
  test("adds a custom prompt draft", () => {
    const onUpdateCustomPrompts = mock();
    const renderer = render(
      createElement(SettingsCustomPromptsSection, {
        customPrompts: [],
        validationErrors: {},
        disabled: false,
        onUpdateCustomPrompts,
      }),
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: /add prompt/i }));

      expect(onUpdateCustomPrompts).toHaveBeenCalledTimes(1);
      const updater = onUpdateCustomPrompts.mock.calls[0]?.[0];
      if (typeof updater !== "function") {
        throw new Error("Expected custom prompt updater.");
      }
      expect(updater([])).toMatchObject([{ name: "", description: "", content: "" }]);
    } finally {
      renderer.unmount();
    }
  });

  test("updates and deletes an existing custom prompt", () => {
    const onUpdateCustomPrompts = mock();
    const renderer = render(
      createElement(SettingsCustomPromptsSection, {
        customPrompts: CUSTOM_PROMPTS,
        validationErrors: {},
        disabled: false,
        onUpdateCustomPrompts,
      }),
    );

    try {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "summarize" } });
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      expect(onUpdateCustomPrompts).toHaveBeenCalledTimes(2);
      const updateName = onUpdateCustomPrompts.mock.calls[0]?.[0];
      const deletePrompt = onUpdateCustomPrompts.mock.calls[1]?.[0];
      if (typeof updateName !== "function" || typeof deletePrompt !== "function") {
        throw new Error("Expected custom prompt updater callbacks.");
      }

      expect(updateName(CUSTOM_PROMPTS)).toEqual([{ ...CUSTOM_PROMPTS[0], name: "summarize" }]);
      expect(deletePrompt(CUSTOM_PROMPTS)).toEqual([]);
    } finally {
      renderer.unmount();
    }
  });
});

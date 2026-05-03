import { describe, expect, mock, test } from "bun:test";
import type { ReusablePrompt } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsReusablePromptsSection } from "./settings-reusable-prompts-section";

enableReactActEnvironment();

const REUSABLE_PROMPTS: ReusablePrompt[] = [
  {
    id: "prompt-1",
    name: "review",
    description: "Review files",
    content: "Review this:\n$ARGUMENTS",
  },
];

const SECOND_REUSABLE_PROMPT: ReusablePrompt = {
  id: "prompt-2",
  name: "summarize",
  description: "Summarize files",
  content: "Summarize this:\n$ARGUMENTS",
};

describe("SettingsReusablePromptsSection", () => {
  test("focuses the name field after adding a reusable prompt", () => {
    function StatefulReusablePromptsSection() {
      const [reusablePrompts, setReusablePrompts] = useState<ReusablePrompt[]>([]);
      const [selectedReusablePromptId, setSelectedReusablePromptId] = useState<string | null>(null);

      return createElement(SettingsReusablePromptsSection, {
        reusablePrompts,
        selectedReusablePromptId,
        validationErrors: {},
        disabled: false,
        onSelectedReusablePromptIdChange: setSelectedReusablePromptId,
        onUpdateReusablePrompts: (updater) => {
          setReusablePrompts((current) => updater(current));
        },
      });
    }

    const renderer = render(createElement(StatefulReusablePromptsSection));

    try {
      fireEvent.click(screen.getByRole("button", { name: /add reusable prompt/i }));

      const nameInput = screen.getByLabelText("Name");
      expect(document.activeElement).toBe(nameInput);
    } finally {
      renderer.unmount();
    }
  });

  test("adds a reusable prompt draft", () => {
    const onUpdateReusablePrompts = mock();
    const renderer = render(
      createElement(SettingsReusablePromptsSection, {
        reusablePrompts: [],
        selectedReusablePromptId: null,
        validationErrors: {},
        disabled: false,
        onSelectedReusablePromptIdChange: () => {},
        onUpdateReusablePrompts,
      }),
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: /add prompt/i }));

      expect(onUpdateReusablePrompts).toHaveBeenCalledTimes(1);
      const updater = onUpdateReusablePrompts.mock.calls[0]?.[0];
      if (typeof updater !== "function") {
        throw new Error("Expected reusable prompt updater.");
      }
      expect(updater([])).toMatchObject([{ name: "", description: "", content: "" }]);
    } finally {
      renderer.unmount();
    }
  });

  test("updates and deletes an existing reusable prompt", () => {
    const onUpdateReusablePrompts = mock();
    const onSelectedReusablePromptIdChange = mock();
    const renderer = render(
      createElement(SettingsReusablePromptsSection, {
        reusablePrompts: REUSABLE_PROMPTS,
        selectedReusablePromptId: "prompt-1",
        validationErrors: {},
        disabled: false,
        onSelectedReusablePromptIdChange,
        onUpdateReusablePrompts,
      }),
    );

    try {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "summarize" } });
      const deleteButton = screen.getByRole("button", { name: /delete/i });
      expect(deleteButton.querySelector("svg")).not.toBeNull();
      fireEvent.click(deleteButton);

      expect(onUpdateReusablePrompts).toHaveBeenCalledTimes(2);
      const updateName = onUpdateReusablePrompts.mock.calls[0]?.[0];
      const deletePrompt = onUpdateReusablePrompts.mock.calls[1]?.[0];
      if (typeof updateName !== "function" || typeof deletePrompt !== "function") {
        throw new Error("Expected reusable prompt updater callbacks.");
      }

      expect(updateName(REUSABLE_PROMPTS)).toEqual([{ ...REUSABLE_PROMPTS[0], name: "summarize" }]);
      expect(deletePrompt(REUSABLE_PROMPTS)).toEqual([]);
      expect(onSelectedReusablePromptIdChange).toHaveBeenCalledWith(null);
    } finally {
      renderer.unmount();
    }
  });

  test("selects added prompts and shows field errors on prompt tabs", () => {
    const onUpdateReusablePrompts = mock();
    const onSelectedReusablePromptIdChange = mock();
    const renderer = render(
      createElement(SettingsReusablePromptsSection, {
        reusablePrompts: REUSABLE_PROMPTS,
        selectedReusablePromptId: "prompt-1",
        validationErrors: { "prompt-1": { content: "Prompt content is required." } },
        disabled: false,
        onSelectedReusablePromptIdChange,
        onUpdateReusablePrompts,
      }),
    );

    try {
      expect(screen.getByTitle("1 reusable prompt field error")).toBeTruthy();
      expect(screen.getByText("Prompt content is required.")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /add prompt/i }));

      expect(onSelectedReusablePromptIdChange).toHaveBeenCalledTimes(1);
      expect(onSelectedReusablePromptIdChange.mock.calls[0]?.[0]).toEqual(expect.any(String));
    } finally {
      renderer.unmount();
    }
  });

  test("selects the next prompt when deleting the selected prompt", () => {
    const onUpdateReusablePrompts = mock();
    const onSelectedReusablePromptIdChange = mock();
    const renderer = render(
      createElement(SettingsReusablePromptsSection, {
        reusablePrompts: [...REUSABLE_PROMPTS, SECOND_REUSABLE_PROMPT],
        selectedReusablePromptId: "prompt-1",
        validationErrors: {},
        disabled: false,
        onSelectedReusablePromptIdChange,
        onUpdateReusablePrompts,
      }),
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));

      expect(onUpdateReusablePrompts).toHaveBeenCalledTimes(1);
      expect(onSelectedReusablePromptIdChange).toHaveBeenCalledWith("prompt-2");
    } finally {
      renderer.unmount();
    }
  });
});

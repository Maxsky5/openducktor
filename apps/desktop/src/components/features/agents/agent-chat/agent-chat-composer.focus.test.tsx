import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatComposer } from "./agent-chat-composer";
import { buildModelSelection } from "./agent-chat-test-fixtures";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

const immediateRequestAnimationFrame = ((callback: FrameRequestCallback): number => {
  callback(0);
  return 1;
}) as typeof requestAnimationFrame;

const buildModel = (): AgentChatComposerModel => ({
  taskId: "task-1",
  displayedSessionId: "session-1",
  isInteractionEnabled: true,
  isReadOnly: false,
  readOnlyReason: null,
  busySendBlockedReason: null,
  pendingInlineCommentCount: 0,
  draftStateKey: "draft-1",
  onSend: async () => true,
  isSending: false,
  isStarting: false,
  isSessionWorking: false,
  isWaitingInput: false,
  waitingInputPlaceholder: null,
  isModelSelectionPending: false,
  selectedModelSelection: buildModelSelection(),
  selectedModelDescriptor: null,
  isSelectionCatalogLoading: false,
  supportsSlashCommands: true,
  supportsFileSearch: true,
  slashCommandCatalog: { commands: [] },
  slashCommands: [],
  slashCommandsError: null,
  isSlashCommandsLoading: false,
  searchFiles: async () => [],
  agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
  modelOptions: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
  modelGroups: [
    {
      label: "OpenAI",
      options: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
    },
  ],
  variantOptions: [{ value: "high", label: "high" }],
  onSelectAgent: () => {},
  onSelectModel: () => {},
  onSelectVariant: () => {},
  sessionAgentColors: {},
  contextUsage: null,
  canStopSession: false,
  onStopSession: () => {},
  composerFormRef: createRef<HTMLFormElement>(),
  composerEditorRef: createRef<HTMLDivElement>(),
  onComposerEditorInput: () => {},
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
});

const getComposerSurface = (container: HTMLElement): HTMLElement => {
  const contentRoot = container.querySelector("[data-composer-content-root]");
  const composerSurface = contentRoot?.parentElement;
  if (!(composerSurface instanceof HTMLElement)) {
    throw new Error("Expected composer surface");
  }

  return composerSurface;
};

const getLastTextSegment = (container: HTMLElement): HTMLElement => {
  const textSegments = Array.from(container.querySelectorAll("[data-text-segment-id]"));
  const editable = textSegments.at(-1);
  if (!(editable instanceof HTMLElement)) {
    throw new Error("Expected editable composer text segment");
  }

  return editable;
};

const typeIntoComposer = (container: HTMLElement, value: string): HTMLElement => {
  const editable = getLastTextSegment(container);
  editable.textContent = value;
  const textNode = editable.firstChild;
  if (textNode) {
    const range = document.createRange();
    range.setStart(textNode, value.length);
    range.collapse(true);
    const selection = globalThis.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  fireEvent.input(editable);
  return getLastTextSegment(container);
};

const waitForComposerFocus = async (container: HTMLElement): Promise<HTMLElement> => {
  const editorRoot = getComposerSurface(container);
  await waitFor(() => {
    expect(document.activeElement).toBe(editorRoot);
  });
  return editorRoot;
};

const ComposerWithExternalButton = ({
  model,
}: {
  model: ReturnType<typeof buildModel>;
}): ReactElement => {
  return (
    <>
      <button type="button">External control</button>
      <AgentChatComposer model={model} />
    </>
  );
};

beforeEach(() => {
  globalThis.requestAnimationFrame = immediateRequestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  document.body.innerHTML = "";
});

describe("AgentChatComposer focus", () => {
  test("autofocuses when an interactive displayed session is rendered", async () => {
    const { container } = render(<AgentChatComposer model={buildModel()} />);

    await waitForComposerFocus(container);
  });

  test("autofocuses when the displayed session changes", async () => {
    const { container, rerender } = render(<ComposerWithExternalButton model={buildModel()} />);
    await waitForComposerFocus(container);

    const externalButton = screen.getByRole("button", { name: "External control" });
    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);

    rerender(
      <ComposerWithExternalButton
        model={{
          ...buildModel(),
          displayedSessionId: "session-2",
        }}
      />,
    );

    await waitForComposerFocus(container);
  });

  test("does not autofocus when no session is displayed", async () => {
    const { container } = render(
      <ComposerWithExternalButton
        model={{
          ...buildModel(),
          displayedSessionId: null,
        }}
      />,
    );

    const externalButton = screen.getByRole("button", { name: "External control" });

    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);
    expect(document.activeElement).not.toBe(getComposerSurface(container));
  });

  test("does not autofocus when the displayed session composer is disabled", async () => {
    const { container } = render(
      <ComposerWithExternalButton
        model={{
          ...buildModel(),
          isReadOnly: true,
          readOnlyReason: "Read-only",
        }}
      />,
    );

    const externalButton = screen.getByRole("button", { name: "External control" });

    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);
    expect(document.activeElement).not.toBe(getComposerSurface(container));
  });

  test("autofocuses once when the same displayed session becomes interactive later", async () => {
    const { container, rerender } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          isWaitingInput: true,
          waitingInputPlaceholder: "Waiting for input",
        }}
      />,
    );

    expect(document.activeElement).not.toBe(getComposerSurface(container));

    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          isWaitingInput: false,
        }}
      />,
    );

    await waitForComposerFocus(container);
  });

  test("does not steal focus when delayed readiness completes after the user focuses elsewhere", async () => {
    const { rerender } = render(
      <ComposerWithExternalButton
        model={{
          ...buildModel(),
          isWaitingInput: true,
          waitingInputPlaceholder: "Waiting for input",
        }}
      />,
    );

    const externalButton = screen.getByRole("button", { name: "External control" });

    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);

    rerender(
      <ComposerWithExternalButton
        model={{
          ...buildModel(),
          isWaitingInput: false,
        }}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(externalButton);
    });
  });

  test("does not refocus on same-session rerenders after the user moves focus away", async () => {
    const { container, rerender } = render(<ComposerWithExternalButton model={buildModel()} />);
    await waitForComposerFocus(container);

    const externalButton = screen.getByRole("button", { name: "External control" });

    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);

    rerender(
      <ComposerWithExternalButton
        model={{
          ...buildModel(),
          pendingInlineCommentCount: 1,
        }}
      />,
    );

    expect(document.activeElement).toBe(externalButton);
  });

  test("preserves draft text and places the caret at the end when autofocus runs", async () => {
    const { container, rerender } = render(<AgentChatComposer model={buildModel()} />);
    await waitForComposerFocus(container);

    const lastTextSegment = typeIntoComposer(container, "Continue this draft");
    const editorRoot = getComposerSurface(container);

    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionId: "session-2",
          draftStateKey: "draft-1",
        }}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(editorRoot);
      expect(lastTextSegment.textContent).toContain("Continue this draft");
      expect(globalThis.getSelection?.()?.focusNode).toBe(lastTextSegment.firstChild);
      expect(globalThis.getSelection?.()?.focusOffset).toBe("Continue this draft".length);
    });
  });
});

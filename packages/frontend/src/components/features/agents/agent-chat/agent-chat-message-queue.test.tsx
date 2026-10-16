import { describe, expect, jest, mock, spyOn, test } from "bun:test";
import type { AgentMessageQueueSnapshot, AgentQueuedMessage } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import type { AgentChatMessageQueueAction, AgentChatMessageQueueModel } from "./agent-chat.types";
import { type AgentChatComposerDraft, draftToSerializedText } from "./agent-chat-composer-draft";
import { buildModel } from "./agent-chat-composer-test-helpers";
import {
  AgentChatMessageQueue,
  type AgentChatMessageQueueComposerModel,
  AgentChatMessageQueuePauseNotice,
} from "./agent-chat-message-queue";

type WaitingEntry = Exclude<AgentQueuedMessage, { state: "editing" }>;

const entry = (
  submissionId: string,
  text: string,
  overrides: Partial<WaitingEntry> = {},
): WaitingEntry => ({
  submissionId,
  parts: [{ kind: "text", text }],
  queuedAt: "2026-10-08T10:00:00.000Z",
  state: "queued",
  ...overrides,
});

const editingEntry = (submissionId: string, text: string, editId: string): AgentQueuedMessage => ({
  ...entry(submissionId, text),
  state: "editing",
  editId,
});

const queueOf = (
  entries: AgentQueuedMessage[],
  pause: AgentMessageQueueSnapshot["pause"] = null,
): AgentMessageQueueSnapshot => ({
  target: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    sessionScope: { kind: "repository" },
  },
  revision: 1,
  entries,
  pause,
});

const itemAt = (items: HTMLElement[], index: number): HTMLElement => {
  const item = items[index];
  if (!item) throw new Error(`Expected queued message ${index}.`);
  return item;
};

const renderQueue = (
  queue: AgentMessageQueueSnapshot | null,
  steerBlockedReason: string | null = null,
) => {
  const onAction = mock(async (_action: AgentChatMessageQueueAction) => {});
  const onSaveEdit = mock(
    async (
      _edit: { readonly submissionId: string; readonly editId: string },
      _draft: AgentChatComposerDraft,
    ) => {},
  );
  const model: AgentChatMessageQueueModel = { queue, onAction, onSaveEdit };
  const composer: AgentChatMessageQueueComposerModel = {
    ...buildModel(),
    steerBlockedReason,
    isSessionWorking: true,
  };
  const view = render(<AgentChatMessageQueue model={model} composer={composer} />);
  const rerenderQueue = (
    nextQueue: AgentMessageQueueSnapshot | null,
    displayedSessionKey = composer.displayedSessionKey,
  ) =>
    view.rerender(
      <AgentChatMessageQueue
        model={{ ...model, queue: nextQueue }}
        composer={{ ...composer, displayedSessionKey }}
      />,
    );
  return { onAction, onSaveEdit, rerenderQueue, unmount: view.unmount };
};

describe("AgentChatMessageQueue", () => {
  test("shows queued messages in order with their controls", () => {
    const { onAction } = renderQueue(queueOf([entry("s-1", "First"), entry("s-2", "Second")]));

    const items = within(screen.getByRole("list", { name: "Queued messages" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
    ]);

    fireEvent.click(within(itemAt(items, 1)).getByRole("button", { name: /Steer now/ }));
    fireEvent.click(within(itemAt(items, 0)).getByRole("button", { name: /Edit/ }));

    expect(onAction.mock.calls).toEqual([
      [{ kind: "steer", submissionId: "s-2" }],
      [{ kind: "begin_edit", submissionId: "s-1" }],
    ]);
  });

  test("fans the stack out after a short rest and shows every message in full until it closes", () => {
    jest.useFakeTimers();
    const { unmount } = renderQueue(
      queueOf([
        entry("s-1", "First", {
          parts: [
            { kind: "text", text: "First" },
            {
              kind: "attachment",
              attachment: { id: "a-1", path: "/tmp/brief.pdf", name: "brief.pdf", kind: "pdf" },
            },
          ],
        }),
        entry("s-2", "Second"),
        entry("s-3", "Third"),
      ]),
    );
    try {
      const list = screen.getByRole("list", { name: "Queued messages" });
      const stack = list.parentElement;
      if (!stack) throw new Error("Expected the stack around the list.");
      const items = within(list).getAllByRole("listitem");
      const advance = (ms: number): void => {
        act(() => {
          jest.advanceTimersByTime(ms);
        });
      };
      // A closed stack counts the attachments of a message. An open stack shows them.
      const showsFull = (): boolean => {
        const isFull = within(list).queryByTitle("brief.pdf") !== null;
        expect(within(list).queryByLabelText("1 attachment") === null).toBe(isFull);
        return isFull;
      };
      // The first message goes out first, so it waits at the back of the stack.
      expect(items.map((item) => item.getAttribute("data-depth"))).toEqual(["2", "1", "0"]);
      expect(within(itemAt(items, 2)).getByText("3 queued")).toBeTruthy();
      expect(showsFull()).toBe(false);

      // A pointer that only crosses the stack does not fan it out.
      fireEvent.pointerEnter(list);
      advance(60);
      fireEvent.pointerLeave(list);
      advance(400);
      expect(stack.getAttribute("data-spread")).toBe("false");

      fireEvent.pointerEnter(list);
      advance(100);
      expect(stack.getAttribute("data-spread")).toBe("true");
      expect(showsFull()).toBe(true);
      // A pointer that slips past the edge and comes back keeps the stack open.
      fireEvent.pointerLeave(list);
      advance(100);
      fireEvent.pointerEnter(list);
      advance(400);
      expect(stack.getAttribute("data-spread")).toBe("true");

      // The whole messages stay until the cards have shrunk back to one line.
      fireEvent.pointerLeave(list);
      advance(180);
      expect(stack.getAttribute("data-spread")).toBe("false");
      expect(showsFull()).toBe(true);
      advance(250);
      expect(showsFull()).toBe(false);
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });

  test("shows references with the transcript chips", () => {
    renderQueue(
      queueOf([
        {
          ...entry("s-1", ""),
          parts: [
            { kind: "text", text: "Use" },
            {
              kind: "skill_mention",
              skill: { id: "address-pr", name: "address-pr", path: "/skills/address-pr" },
            },
            { kind: "text", text: "on" },
            {
              kind: "file_reference",
              file: { id: "f-1", path: "src/app.ts", name: "app.ts", kind: "code" },
            },
          ],
        },
      ]),
    );

    const card = screen.getByRole("listitem");
    expect(card.querySelector("p")?.textContent).toBe("Useaddress-pronapp.ts");
    expect(within(card).getByText("app.ts").closest("[title]")?.getAttribute("title")).toBe(
      "src/app.ts",
    );
  });

  test("hides cards behind the third one until the stack fans out", () => {
    renderQueue(queueOf(["A", "B", "C", "D"].map((text, index) => entry(`s-${index}`, text))));

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-buried"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  // The table in agent-chat-steering.test.ts covers each steering rule.
  test("explains why steering is unavailable, disables Steer now, and keeps the message", () => {
    const { onAction } = renderQueue(
      queueOf([entry("s-1", "First")]),
      "Update Codex to 0.106.0 or later.",
    );

    const steer = screen.getByRole("button", {
      name: /Steer now/,
      description: "Update Codex to 0.106.0 or later.",
    });
    expect(steer.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Update Codex to 0.106.0 or later/)).toBeTruthy();
    fireEvent.click(steer);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole("listitem").textContent).toContain("First");
    expect(
      screen.getByRole("button", { name: "Remove queued message" }).hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "begin_edit", submissionId: "s-1" });
  });

  test("shows a started delivery without actions and keeps its error visible", () => {
    renderQueue(
      queueOf([
        entry("s-1", "First", { state: "sending" }),
        entry("s-2", "Second", { error: "Runtime is not ready." }),
      ]),
    );

    const items = screen.getAllByRole("listitem");
    expect(within(itemAt(items, 0)).getByText("Sending…")).toBeTruthy();
    expect(within(itemAt(items, 0)).queryByRole("button")).toBeNull();
    expect(within(itemAt(items, 1)).getByRole("alert").textContent).toBe("Runtime is not ready.");
  });

  test("shows a pause with its cause and resumes the queue", async () => {
    const onAction = mock(async (_action: AgentChatMessageQueueAction) => {});
    render(
      <AgentChatMessageQueuePauseNotice
        model={{
          queue: queueOf([entry("s-1", "First")], { message: "You stopped the agent." }),
          onAction,
          onSaveEdit: async () => {},
        }}
      />,
    );

    expect(screen.getByText("Queue paused.")).toBeTruthy();
    expect(screen.getByText("You stopped the agent.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume queue/ }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "resume" }));
  });

  test("edits a queued message in its card and saves the new draft", async () => {
    const { onAction, onSaveEdit } = renderQueue(
      queueOf([editingEntry("s-1", "Original", "edit-1")]),
    );

    expect(screen.getByRole("combobox", { name: "Message composer" }).textContent).toContain(
      "Original",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveEdit).toHaveBeenCalledTimes(1));
    const [edit, draft] = onSaveEdit.mock.calls[0] ?? [];
    expect(edit).toEqual({ submissionId: "s-1", editId: "edit-1" });
    expect(draft ? draftToSerializedText(draft) : null).toBe("Original");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: "cancel_edit",
        submissionId: "s-1",
        editId: "edit-1",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: "remove",
        submissionId: "s-1",
        editId: "edit-1",
      }),
    );
  });

  test("cancels an edit with Escape", async () => {
    const { onAction } = renderQueue(queueOf([editingEntry("s-1", "Original", "edit-1")]));

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Message composer" }), {
      key: "Escape",
    });

    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: "cancel_edit",
        submissionId: "s-1",
        editId: "edit-1",
      }),
    );
  });

  test("shows the composer failure for a file type that an edit cannot attach", () => {
    const failure = spyOn(toast, "error").mockImplementation(() => "failure");
    try {
      renderQueue(queueOf([editingEntry("s-1", "Original", "edit-1")]));

      fireEvent.change(screen.getByLabelText("Add attachments to queued message"), {
        target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
      });

      expect(failure).toHaveBeenCalledTimes(1);
      const [title, options] = failure.mock.calls[0] ?? [];
      expect(title).toBe("Unsupported attachment type");
      const description = options?.description;
      if (!isValidElement(description)) throw new Error("Expected a description element.");
      expect(renderToStaticMarkup(description)).toBe(
        "<span><code>notes.txt</code> is not an image, audio file, video, or PDF.</span>",
      );
      expect(screen.queryByTitle("notes.txt")).toBeNull();
    } finally {
      failure.mockRestore();
    }
  });

  test("moves focus into the edit card while the Edit action still runs", () => {
    const { onAction, rerenderQueue } = renderQueue(queueOf([entry("s-1", "Original")]));
    onAction.mockImplementationOnce(() => new Promise<void>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Edit queued message" }));

    rerenderQueue(queueOf([editingEntry("s-1", "Original", "edit-1")]));

    const editor = screen.getByRole("combobox", { name: "Message composer" });
    expect(editor.getAttribute("aria-disabled")).toBe("false");
    expect(editor.contains(document.activeElement)).toBe(true);
  });

  test("lets the menus of the editor show outside an edit card once it has opened", () => {
    const { rerenderQueue } = renderQueue(queueOf([entry("s-1", "Original")]));
    rerenderQueue(queueOf([editingEntry("s-1", "Original", "edit-1")]));

    const card = document.querySelector(".queued-message-edit");
    if (!card) throw new Error("Expected an edit card.");
    // The card clips its content only while it grows in.
    expect(card.getAttribute("data-open")).toBe("false");
    fireEvent.transitionEnd(card);
    expect(card.getAttribute("data-open")).toBe("true");
  });

  test("shows a message with an unknown delivery result without any action", () => {
    renderQueue(
      queueOf([
        entry("s-1", "First", {
          state: "acceptance_unknown",
          error: "OpenDucktor cannot tell if the agent received this message.",
        }),
      ]),
    );

    expect(screen.getByText("Delivery unknown")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("cannot tell");
    const item = screen.getByRole("listitem");
    expect(within(item).queryByRole("button")).toBeNull();
  });

  test("shows the save spinner only while Save runs", async () => {
    const { onAction } = renderQueue(queueOf([editingEntry("s-1", "First", "edit-1")]));
    onAction.mockImplementationOnce(() => new Promise<void>(() => {}));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true),
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(save.querySelector(".animate-spin")).toBeNull();
  });

  test("keeps an unsaved edit when another chat replaces the queue, until the edit ends", async () => {
    const editing = queueOf([editingEntry("s-keep", "Original", "edit-keep")]);
    const { rerenderQueue, onAction } = renderQueue(editing);
    const composer = () => screen.getByRole("combobox", { name: "Message composer" });
    const segment = composer().querySelector<HTMLElement>("[data-segment-id]");
    if (!segment) throw new Error("Expected an editable segment.");
    segment.textContent = "Unsaved change";
    fireEvent.input(segment);
    await waitFor(() => expect(composer().textContent).toContain("Unsaved change"));

    rerenderQueue(null, "session-2");
    rerenderQueue(editing, "session-1");

    expect(composer().textContent).toContain("Unsaved change");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: "cancel_edit",
        submissionId: "s-keep",
        editId: "edit-keep",
      }),
    );
    rerenderQueue(null, "session-2");
    rerenderQueue(editing, "session-1");
    expect(composer().textContent).toContain("Original");
  });

  test("keeps the other cards in place when one leaves the queue", () => {
    const { rerenderQueue } = renderQueue(
      queueOf([entry("s-1", "First"), entry("s-2", "Second"), entry("s-3", "Third")]),
    );
    const cardOf = (text: string): HTMLLIElement => {
      const item = screen.getByText(text).closest("li");
      if (!item) throw new Error(`Expected the card of ${text}.`);
      return item;
    };
    const first = cardOf("First");
    const third = cardOf("Third");

    rerenderQueue(queueOf([entry("s-1", "First"), entry("s-3", "Third")]));

    // The leaving card shrinks out, hidden from assistive technology. The others keep their
    // elements, so nothing redraws.
    expect(cardOf("Second").getAttribute("data-presence")).toBe("exiting");
    expect(screen.getAllByRole("listitem")).toEqual([first, third]);
    expect(cardOf("First")).toBe(first);
    expect(cardOf("Third")).toBe(third);
  });

  test("renders nothing without a queue", () => {
    renderQueue(null);

    expect(screen.queryByRole("region", { name: "Message queue" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });
});

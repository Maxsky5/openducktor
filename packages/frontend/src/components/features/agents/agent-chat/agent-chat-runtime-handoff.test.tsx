import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { RuntimeHandoffCue } from "./agent-chat-runtime-handoff";

test("cancel returns focus to the composer without dropping the draft", () => {
  function Chat() {
    const editor = useRef<HTMLDivElement>(null);
    const [pending, setPending] = useState(true);
    return (
      <>
        <RuntimeHandoffCue
          notice={
            pending
              ? {
                  direction: { from: "codex", to: "claude" },
                  destinationModel: "Sonnet",
                  title: "Handoff pending",
                  details: "Send shares earlier messages with the destination.",
                  cancel: () => {
                    setPending(false);
                    return true;
                  },
                  check: null,
                }
              : null
          }
          sourceModel="GPT"
          currentRuntime="codex"
          editorRef={editor}
        />
        <div
          ref={editor}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Message composer"
        >
          My draft
        </div>
      </>
    );
  }

  const view = render(<Chat />);
  const cancel = view.getByRole("button", { name: "Cancel handoff" });
  cancel.focus();
  fireEvent.click(cancel);

  const editor = view.getByRole("textbox", { name: "Message composer" });
  expect(document.activeElement).toBe(editor);
  expect(editor.textContent).toBe("My draft");
  expect(view.queryByRole("button", { name: "Cancel handoff" })).toBeNull();
});

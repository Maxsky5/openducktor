import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { usePreviewBranchKey } from "./use-preview-branch-key";

function Draft({ branch }: { branch: string | null }) {
  const key = usePreviewBranchKey(branch);
  return <Editor key={key} />;
}

function Editor() {
  const [text, setText] = useState("");
  return (
    <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
  );
}

test("the first branch result keeps a draft and a later branch change clears it", () => {
  const view = render(<Draft branch={null} />);
  try {
    const input = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.change(input, { target: { value: "unsaved draft" } });
    view.rerender(<Draft branch="main" />);
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    view.rerender(<Draft branch={null} />);
    view.rerender(<Draft branch="main" />);
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    view.rerender(<Draft branch="feature" />);
    expect(screen.getByDisplayValue("")).not.toBe(input);
  } finally {
    view.unmount();
  }
});

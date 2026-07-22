import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import TaskDescriptionEditor from "./task-description-editor";

const props = {
  workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
  taskId: "task-1",
  onUpload: async () => ({
    assetId: "550e8400-e29b-41d4-a716-446655440000",
    scope: "description" as const,
    originalName: "diagram.png",
    verifiedMediaType: "image/png" as const,
    byteSize: 3,
  }),
  uploads: [],
  previews: new Map<string, string>(),
};

describe("TaskDescriptionEditor", () => {
  test("switching modes without edits preserves the original source", async () => {
    const onChange = mock((_value: string) => {});
    const markdown = "-   unusual marker\r\n";
    const view = render(
      <TaskDescriptionEditor {...props} markdown={markdown} onChange={onChange} />,
    );

    await waitFor(() =>
      expect((view.getByRole("button", { name: "Visual" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(view.getByRole("button", { name: "Markdown" }));
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(markdown);
    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    await waitFor(() => expect(view.container.querySelector(".tiptap")).not.toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  test("keeps unsupported syntax in Markdown mode with an actionable reason", async () => {
    const view = render(
      <TaskDescriptionEditor
        {...props}
        markdown={"Read [the docs][docs].\n\n[docs]: https://example.com"}
        onChange={() => {}}
      />,
    );

    expect(view.getByRole("textbox")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    expect((await view.findByRole("alert")).textContent).toContain("Reference-style links");
    expect(view.getByRole("textbox")).toBeTruthy();
  });

  test("keeps escaped-pipe GFM tables in Markdown mode before TipTap can serialize them", async () => {
    const onChange = mock((_value: string) => {});
    const markdown = "| Value | Meaning |\n| :---- | ------: |\n| a\\|b | literal pipe |";
    const view = render(
      <TaskDescriptionEditor {...props} markdown={markdown} onChange={onChange} />,
    );

    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(markdown);
    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    expect((await view.findByRole("alert")).textContent).toContain("escaped pipe");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("keeps links that fail the live codec round trip in Markdown mode", async () => {
    const onChange = mock((_value: string) => {});
    const markdown = "[a](<https://x.test/a b>)";
    const view = render(
      <TaskDescriptionEditor {...props} markdown={markdown} onChange={onChange} />,
    );

    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(markdown);
    expect((await view.findByRole("alert")).textContent).toContain("cannot be preserved");
    expect((view.getByRole("button", { name: "Visual" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    expect(view.getByRole("textbox")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("preserves front matter outside Visual mode and keeps it source-editable", async () => {
    const markdown = "---\ntitle: Keep comments # exact\n---\nBody";
    const view = render(
      <TaskDescriptionEditor {...props} markdown={markdown} onChange={() => {}} />,
    );

    expect(view.getByText(/Front matter preserved/)).toBeTruthy();
    await waitFor(() =>
      expect((view.getByRole("button", { name: "Visual" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(view.getByRole("button", { name: "Markdown" }));
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(markdown);
  });

  test("external replacements hydrate Visual mode without emitting updates", async () => {
    const onChange = mock((_value: string) => {});
    const view = render(<TaskDescriptionEditor {...props} markdown="First" onChange={onChange} />);
    await waitFor(() => expect(view.container.querySelector(".tiptap")).not.toBeNull());

    view.rerender(<TaskDescriptionEditor {...props} markdown="Second" onChange={onChange} />);

    await waitFor(() => expect(view.container.textContent).toContain("Second"));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("keeps Visual mode mounted when a controlled parent accepts a user edit", async () => {
    const onChange = mock((_value: string) => {});
    const ControlledEditor = () => {
      const [markdown, setMarkdown] = useState("Formula");
      return (
        <TaskDescriptionEditor
          {...props}
          markdown={markdown}
          onChange={(nextMarkdown) => {
            onChange(nextMarkdown);
            setMarkdown(nextMarkdown);
          }}
        />
      );
    };
    const view = render(<ControlledEditor />);
    await waitFor(() => expect(view.getByRole("button", { name: "Inline math" })).toBeTruthy());

    fireEvent.click(view.getByRole("button", { name: "Inline math" }));
    const input = await view.findByRole("textbox", { name: "LaTeX formula" });
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalled();
    expect(view.container.querySelector(".tiptap")).not.toBeNull();
    expect(
      view.queryByRole("textbox", { name: "Problem context, scope, and expected output." }),
    ).toBeNull();
  });

  test("resets mode and gate when switching from an incompatible task to a compatible task", async () => {
    const onChange = mock((_value: string) => {});
    const view = render(
      <TaskDescriptionEditor
        {...props}
        taskId="task-incompatible"
        markdown={"Read [the docs][docs].\n\n[docs]: https://example.com"}
        onChange={onChange}
      />,
    );

    expect(view.getByRole("textbox")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    expect((await view.findByRole("alert")).textContent).toContain("Reference-style links");

    view.rerender(
      <TaskDescriptionEditor
        {...props}
        taskId="task-compatible"
        markdown="Compatible body"
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(view.container.querySelector(".tiptap")).not.toBeNull());
    expect(view.queryByRole("alert")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("resets to a gated Markdown mode when switching to an incompatible task", async () => {
    const onChange = mock((_value: string) => {});
    const view = render(
      <TaskDescriptionEditor
        {...props}
        taskId="task-compatible"
        markdown="Compatible body"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(view.container.querySelector(".tiptap")).not.toBeNull());

    view.rerender(
      <TaskDescriptionEditor
        {...props}
        taskId="task-incompatible"
        markdown={"Read [the docs][docs].\n\n[docs]: https://example.com"}
        onChange={onChange}
      />,
    );

    expect(await view.findByRole("textbox")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    expect((await view.findByRole("alert")).textContent).toContain("Reference-style links");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("the image picker stages and inserts a logical asset reference", async () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const onChange = mock((_value: string) => {});
    const onUpload = mock(async () => ({
      assetId,
      scope: "description" as const,
      originalName: "diagram.png",
      verifiedMediaType: "image/png" as const,
      byteSize: 3,
    }));
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:diagram";
    URL.revokeObjectURL = () => {};

    try {
      const view = render(
        <TaskDescriptionEditor
          {...props}
          markdown="Body"
          onChange={onChange}
          onUpload={onUpload}
        />,
      );
      await waitFor(() => expect(view.getByRole("button", { name: "Insert image" })).toBeTruthy());
      const input = view.container.querySelector('input[type="file"]');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Expected the task image picker input.");
      }
      const file = new File([new Uint8Array([1, 2, 3])], "diagram.png", {
        type: "image/png",
      });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
      await waitFor(() =>
        expect(
          onChange.mock.calls.some(([value]) => String(value).includes(`odt-asset:${assetId}`)),
        ).toBe(true),
      );
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("stages an image pasted into Visual mode", async () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440001";
    const onChange = mock((_value: string) => {});
    const onUpload = mock(async (file: File) => ({
      assetId,
      scope: "description" as const,
      originalName: file.name,
      verifiedMediaType: "image/png" as const,
      byteSize: file.size,
    }));
    const file = new File([new Uint8Array([1])], "pasted.png", { type: "image/png" });
    const view = render(
      <TaskDescriptionEditor {...props} markdown="Body" onChange={onChange} onUpload={onUpload} />,
    );
    await waitFor(() => expect(view.container.querySelector(".tiptap")).not.toBeNull());

    fireEvent.paste(view.container.querySelector(".tiptap") as Element, {
      clipboardData: { files: [file] },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([value]) => String(value).includes(`odt-asset:${assetId}`)),
      ).toBe(true),
    );
  });

  test("keeps successful drag-and-drop uploads when another file fails", async () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440002";
    const onChange = mock((_value: string) => {});
    const failedFile = new File([new Uint8Array([1])], "bad.png", { type: "image/png" });
    const acceptedFile = new File([new Uint8Array([2])], "accepted.png", {
      type: "image/png",
    });
    const onUpload = mock(async (file: File) => {
      if (file === failedFile) {
        throw new Error("Rejected image");
      }
      return {
        assetId,
        scope: "description" as const,
        originalName: file.name,
        verifiedMediaType: "image/png" as const,
        byteSize: file.size,
      };
    });
    const view = render(
      <TaskDescriptionEditor {...props} markdown="Body" onChange={onChange} onUpload={onUpload} />,
    );
    await waitFor(() => expect(view.container.querySelector(".tiptap")).not.toBeNull());

    fireEvent.drop(view.container.querySelector(".tiptap") as Element, {
      dataTransfer: { files: [failedFile, acceptedFile] },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([value]) => String(value).includes(`odt-asset:${assetId}`)),
      ).toBe(true),
    );
  });

  test("inserts an arbitrary inline formula from the accessible math editor", async () => {
    const onChange = mock((_value: string) => {});
    const view = render(
      <TaskDescriptionEditor {...props} markdown="Formula" onChange={onChange} />,
    );
    await waitFor(() => expect(view.getByRole("button", { name: "Inline math" })).toBeTruthy());

    fireEvent.click(view.getByRole("button", { name: "Inline math" }));
    const dialog = await view.findByRole("dialog", { name: "Insert inline formula" });
    const input = view.getByRole("textbox", { name: "LaTeX formula" });
    fireEvent.change(input, { target: { value: "\\frac{a}{b}" } });
    fireEvent.click(view.getByRole("button", { name: "Insert formula" }));

    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await waitFor(() =>
      expect(onChange.mock.calls.some(([value]) => String(value).includes("$\\frac{a}{b}$"))).toBe(
        true,
      ),
    );
  });

  test("edits a selected formula and validates or cancels without changing Markdown", async () => {
    const onChange = mock((_value: string) => {});
    const view = render(
      <TaskDescriptionEditor {...props} markdown="Formula $x$" onChange={onChange} />,
    );
    const mathNode = await waitFor(() => {
      const node = view.container.querySelector('[data-type="inline-math"]');
      expect(node).not.toBeNull();
      return node as Element;
    });

    fireEvent.click(mathNode);
    expect(await view.findByRole("dialog", { name: "Edit inline formula" })).toBeTruthy();
    const input = view.getByRole("textbox", { name: "LaTeX formula" });
    expect((input as HTMLInputElement).value).toBe("x");
    fireEvent.change(input, { target: { value: "\\frac{" } });
    fireEvent.click(view.getByRole("button", { name: "Save formula" }));
    expect((await view.findByRole("alert")).textContent).toContain("valid LaTeX");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(view.queryByRole("dialog", { name: "Edit inline formula" })).toBeNull(),
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(mathNode);
    expect(await view.findByRole("dialog", { name: "Edit inline formula" })).toBeTruthy();
    const replacement = view.getByRole("textbox", { name: "LaTeX formula" });
    fireEvent.change(replacement, { target: { value: "y^2" } });
    fireEvent.keyDown(replacement, { key: "Enter" });
    await waitFor(() =>
      expect(onChange.mock.calls.some(([value]) => String(value).includes("$y^2$"))).toBe(true),
    );
  });

  test("inserts arbitrary block math with the documented keyboard shortcut", async () => {
    const onChange = mock((_value: string) => {});
    const view = render(<TaskDescriptionEditor {...props} markdown="Body" onChange={onChange} />);
    await waitFor(() => expect(view.getByRole("button", { name: "Block math" })).toBeTruthy());

    fireEvent.click(view.getByRole("button", { name: "Block math" }));
    expect(await view.findByRole("dialog", { name: "Insert block formula" })).toBeTruthy();
    const input = view.getByRole("textbox", { name: "LaTeX formula" });
    fireEvent.change(input, { target: { value: "\\sum_{i=1}^{n} i" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([value]) => String(value).includes("$$\n\\sum_{i=1}^{n} i\n$$")),
      ).toBe(true),
    );
  });
});

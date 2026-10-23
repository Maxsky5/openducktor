import { expect, spyOn, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FreeTaskArtifact, TaskArtifact } from "@openducktor/contracts";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { IsolatedMarkdownWrapper } from "@/test-utils/isolated-markdown-wrapper";
import { TaskArtifactPreview } from "./task-artifact-preview";

const artifact = (mediaType: string): FreeTaskArtifact => ({
  artifactId: "output",
  taskId: "task",
  revision: 1,
  updatedAt: null,
  name: "Output",
  classification: "free",
  code: "test-output",
  fileName: "output.txt",
  mediaType,
  byteSize: 0,
});

test.each([
  ["plain content", "Requirements are visible."],
  [
    "code, math, and Mermaid",
    "Formula $x^2$\n\n```javascript\nconst value = 1;\n```\n\n```mermaid\nflowchart TD\nA --> B\n```",
  ],
])("workflow Markdown shows %s on its first render", (_name, content) => {
  const workflow: TaskArtifact = {
    artifactId: "workflow:task:spec",
    taskId: "task",
    name: "Specification",
    revision: 1,
    updatedAt: null,
    classification: "workflow",
    workflowKind: "spec",
    mediaType: "text/markdown",
  };
  const markup = renderToStaticMarkup(
    <IsolatedMarkdownWrapper>
      <ThemeProvider>
        <TaskArtifactPreview
          artifact={workflow}
          bytes={new TextEncoder().encode(`# Requirements\n\n${content}`)}
          markdownAssetContext={{
            workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
            taskId: "task",
            scope: "description",
          }}
        />
      </ThemeProvider>
    </IsolatedMarkdownWrapper>,
  );
  expect(markup.match(/<h1[^>]*>Requirements<\/h1>/g)).toHaveLength(1);
});

test("plain text stays literal and preserves whitespace instead of becoming app markup", () => {
  const text = "\ufeff  <script>bad()</script>\r\nnext";
  const result = renderToStaticMarkup(
    <TaskArtifactPreview
      artifact={artifact("text/plain")}
      bytes={new TextEncoder().encode(text)}
    />,
  );
  expect(result).toContain("\ufeff  &lt;script&gt;bad()&lt;/script&gt;\r\nnext");
  expect(result).not.toContain("<script>");
});

test("invalid supported text and unsupported formats have distinct outcomes", () => {
  const invalid = renderToStaticMarkup(
    <TaskArtifactPreview artifact={artifact("text/html")} bytes={new Uint8Array([0xff])} />,
  );
  expect(invalid).toContain("Cannot preview Output");
  expect(invalid).toContain("not valid UTF-8");
  const unsupported = renderToStaticMarkup(
    <TaskArtifactPreview artifact={artifact("application/pdf")} bytes={new Uint8Array([0xff])} />,
  );
  expect(unsupported).toContain("No preview is available for application/pdf");
  expect(unsupported).not.toContain("Cannot preview");
});

test("SVG uses image mode and releases the original-byte URL after a preview failure", async () => {
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
  );
  const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:artifact-image");
  const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = render(<TaskArtifactPreview artifact={artifact("image/svg+xml")} bytes={bytes} />);
  try {
    const img = view.getByRole("img", { name: "Output" });
    expect(img.getAttribute("src")).toBe("blob:artifact-image");
    expect(view.container.querySelector("svg, object, iframe, script")).toBeNull();
    const blob = create.mock.calls[0]![0];
    if (!(blob instanceof Blob))
      throw new Error("The image preview must retain file bytes in a Blob.");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    fireEvent.error(img);
    expect(view.getByRole("alert").textContent).toContain("image could not be decoded");
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:artifact-image");
  } finally {
    view.unmount();
    create.mockRestore();
    revoke.mockRestore();
  }
});

test("rename keeps the image URL and replacement recovers a failed image with new bytes", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const original = artifact("image/png");
  const create = spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:second");
  const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = render(<TaskArtifactPreview artifact={original} bytes={bytes} />);
  try {
    const image = view.getByRole("img", { name: "Output" });
    view.rerender(
      <TaskArtifactPreview artifact={{ ...original, name: "Renamed" }} bytes={bytes} />,
    );
    expect(view.getByRole("img", { name: "Renamed" }).isSameNode(image)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.error(image);
    expect(view.getByRole("alert").textContent).toContain("image could not be decoded");
    view.rerender(
      <TaskArtifactPreview
        artifact={{ ...original, name: "Replaced" }}
        bytes={new Uint8Array([3, 2, 1])}
      />,
    );
    expect(view.getByRole("img", { name: "Replaced" }).getAttribute("src")).toBe("blob:second");
    expect(view.queryByRole("alert")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:first");
  } finally {
    view.unmount();
    create.mockRestore();
    revoke.mockRestore();
  }
});

import { expect, mock, test } from "bun:test";
import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { MarkdownFileImage } from "./markdown-file-image";

test("keeps each Markdown image tied to its file across pending reads and reports failures", async () => {
  const previousBridge = getShellBridge();
  const pending = createDeferred<WorkspaceTextFileReadResult>();
  const resolvePath = mock<HostClient["filesystemResolvePath"]>(async (path) => {
    if (path === "/repo/docs/plot.png") return path;
    if (path === "C:/repo/notes/../media/plot.png") return "C:/repo/media/plot.png";
    if (path.endsWith("gone.png")) return null;
    if (path.endsWith("private.png")) throw new Error("Permission denied: private.png");
    throw new Error(`Unexpected path: ${path}`);
  });
  const read = mock<HostClient["filesystemReadTextFile"]>(async (input) => {
    if (input.rootPath === "/repo/docs") return pending.promise;
    return {
      kind: "image",
      rootPath: input.rootPath,
      relativePath: input.relativePath,
      mime: "image/png",
      base64: "bmV3",
      revision: "new",
      size: 3,
      mtimeMs: 1,
    };
  });
  configureShellBridge(
    createShellBridgeFixture({
      client: { filesystemResolvePath: resolvePath, filesystemReadTextFile: read },
    }),
  );
  const image = { src: "./plot.png", alt: "Plot", title: undefined, className: "image" };
  const file = { rootPath: "/repo", relativePath: "docs/a.md" };
  const view = render(
    <QueryProvider useIsolatedClient>
      <MarkdownFileImage file={file} {...image} />
    </QueryProvider>,
  );
  try {
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith({
        rootPath: "/repo/docs",
        relativePath: "plot.png",
        access: "local",
      }),
    );
    const nextFile = { rootPath: "C:/repo", relativePath: "notes/b.md", access: "local" as const };
    const nextView = (src: string) => (
      <QueryProvider useIsolatedClient>
        <MarkdownFileImage file={nextFile} {...image} src={src} />
      </QueryProvider>
    );
    view.rerender(nextView("../media/plot.png"));
    expect((await view.findByRole("img", { name: "Plot" })).getAttribute("src")).toBe(
      "data:image/png;base64,bmV3",
    );
    expect(resolvePath).toHaveBeenCalledWith("C:/repo/notes/../media/plot.png");
    await act(async () => {
      pending.resolve({
        kind: "image",
        rootPath: "/repo/docs",
        relativePath: "plot.png",
        mime: "image/png",
        base64: "b2xk",
        revision: "old",
        size: 3,
        mtimeMs: 1,
      });
      await pending.promise;
    });
    expect(view.getByRole("img", { name: "Plot" }).getAttribute("src")).toBe(
      "data:image/png;base64,bmV3",
    );
    fireEvent.error(view.getByRole("img", { name: "Plot" }));
    expect(view.getByRole("status").textContent).toContain("could not be displayed");
    view.rerender(nextView("./gone.png"));
    await view.findByText("Image file does not exist: C:/repo/notes/gone.png");
    view.rerender(nextView("./private.png"));
    await view.findByText("Permission denied: private.png");
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    configureShellBridge(previousBridge);
  }
});

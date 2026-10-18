import { expect, mock, test } from "bun:test";
import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { filesystemQueryKeys } from "@openducktor/frontend-core/queries/filesystem";
import { MarkdownFileImage } from "./markdown-file-image";

test("bounds image reads, cancels queued reads on close, and releases unused image data", async () => {
  const names = ["one.png", "two.png", "three.png", "four.png"];
  const pending = new Map(
    names.map((name) => [name, createDeferred<WorkspaceTextFileReadResult>()]),
  );
  const result = (name: string): WorkspaceTextFileReadResult => ({
    kind: "image",
    rootPath: "/repo/docs",
    relativePath: name,
    mime: "image/png",
    base64: "aW1hZ2U=",
    revision: name,
    size: 5,
    mtimeMs: 1,
  });
  const read = mock<HostClient["filesystemReadTextFile"]>(async ({ relativePath }) => {
    const request = pending.get(relativePath);
    if (!request) throw new Error(`Unexpected image: ${relativePath}`);
    return request.promise;
  });
  const connection = createTestClientConnection({
    client: {
      filesystemResolvePath: async (path) => path,
      filesystemReadTextFile: read,
    },
  });
  const client = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      {names.map((name) => (
        <MarkdownFileImage
          key={name}
          file={{ rootPath: "/repo", relativePath: "docs/report.md" }}
          src={name}
          alt={name}
          title={undefined}
          className="image"
        />
      ))}
    </ClientConnectionProvider>,
  );
  try {
    await waitFor(() => {
      expect(
        client.getQueryCache().findAll({
          queryKey: filesystemQueryKeys.textFileRoot("/repo/docs"),
          predicate: (query) => query.state.fetchStatus === "fetching",
        }),
      ).toHaveLength(4);
      expect(read).toHaveBeenCalledTimes(2);
    });
    const first = read.mock.calls[0]?.[0].relativePath;
    if (!first) throw new Error("Expected an active image read");
    await act(async () => {
      pending.get(first)?.resolve(result(first));
    });
    await view.findByRole("img", { name: first });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));

    // A regular file preview can retain the same file independently of Markdown images.
    const sharedKey = filesystemQueryKeys.textFile("/repo/docs", first, "local");
    client.setQueryData<WorkspaceTextFileReadResult>(sharedKey, result(first));
    view.unmount();
    await act(async () => {
      for (const [name, request] of pending) request.resolve(result(name));
      await Promise.all([...pending.values()].map((request) => request.promise));
    });
    await waitFor(() =>
      expect(
        client
          .getQueriesData<WorkspaceTextFileReadResult>({
            queryKey: filesystemQueryKeys.textFileRoot("/repo/docs"),
          })
          .filter(([, data]) => data?.kind === "image"),
      ).toHaveLength(1),
    );
    expect(client.getQueryData<WorkspaceTextFileReadResult>(sharedKey)).toEqual(result(first));
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    for (const [name, request] of pending) request.resolve(result(name));
    await Promise.all([...pending.values()].map((request) => request.promise));
    client.clear();
  }
});

test("keeps each Markdown image tied to its file across pending reads and reports failures", async () => {
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
  const connection = createTestClientConnection({
    client: { filesystemResolvePath: resolvePath, filesystemReadTextFile: read },
  });
  const image = { src: "./plot.png", alt: "Plot", title: undefined, className: "image" };
  const file = { rootPath: "/repo", relativePath: "docs/a.md" };
  const view = render(
    <QueryProvider connection={connection}>
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
      <QueryProvider connection={connection}>
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
  }
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/shared/host";
import { TaskDescriptionImageContext } from "./task-description-image-context";
import { TaskDescriptionImageNode } from "./task-description-image-node";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("TaskDescriptionImageNode", () => {
  test("loads a linked GitHub issue image through the authenticated host request", async () => {
    const originalImageGet = host.issueImageGet;
    const url = "https://github.com/user-attachments/assets/550e8400-e29b-41d4-a716-446655440000";
    const imageGet = mock(async () => ({
      mediaType: "image/png" as const,
      bytesBase64: "aW1hZ2U=",
    }));
    host.issueImageGet = imageGet;
    try {
      const view = render(
        <QueryProvider useIsolatedClient>
          <TaskDescriptionImageContext.Provider
            value={{
              previews: new Map(),
              renderContext: null,
              issueImageContext: {
                providerId: "github",
                repoPath: "/workspace/repo",
                sourceId: "132",
              },
            }}
          >
            <TaskDescriptionImageNode
              node={{ attrs: { src: url, alt: "Issue image", title: null } }}
              selected={false}
              updateAttributes={() => {}}
            />
          </TaskDescriptionImageContext.Provider>
        </QueryProvider>,
      );
      try {
        const image = await view.findByRole("img", { name: "Issue image" });
        expect(image.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
        expect(imageGet).toHaveBeenCalledWith({
          repoPath: "/workspace/repo",
          sourceId: "132",
          url,
        });
      } finally {
        view.unmount();
      }
    } finally {
      host.issueImageGet = originalImageGet;
    }
  });

  test("does not resolve the same durable image again when its context object is recreated", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const props = {
      node: {
        attrs: { src: `odt-asset:${assetId}`, alt: "Architecture", title: null },
      },
      selected: false,
      updateAttributes: () => {},
    } satisfies ComponentProps<typeof TaskDescriptionImageNode>;
    const context = {
      workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
      taskId: "task-1",
      scope: "description" as const,
    };
    const view = render(
      <TaskDescriptionImageContext.Provider value={{ previews: new Map(), renderContext: context }}>
        <TaskDescriptionImageNode {...props} />
      </TaskDescriptionImageContext.Provider>,
    );

    await waitFor(() => expect(resolveTaskAssetSrc).toHaveBeenCalledTimes(1));
    view.rerender(
      <TaskDescriptionImageContext.Provider
        value={{ previews: new Map(), renderContext: { ...context } }}
      >
        <TaskDescriptionImageNode {...props} />
      </TaskDescriptionImageContext.Provider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveTaskAssetSrc).toHaveBeenCalledTimes(1);
  });

  test("shows the image error state when a resolved asset response fails to load", async () => {
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc: async () => "openducktor-task-asset://missing",
    });
    const props = {
      node: {
        attrs: {
          src: "odt-asset:550e8400-e29b-41d4-a716-446655440000",
          alt: "Architecture",
          title: null,
        },
      },
      selected: false,
      updateAttributes: () => {},
    } satisfies ComponentProps<typeof TaskDescriptionImageNode>;
    const view = render(
      <TaskDescriptionImageContext.Provider
        value={{
          previews: new Map(),
          renderContext: {
            workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
            taskId: "task-1",
            scope: "description",
          },
        }}
      >
        <TaskDescriptionImageNode {...props} />
      </TaskDescriptionImageContext.Provider>,
    );

    const image = await waitFor(() => view.getByRole("img", { name: "Architecture" }));
    fireEvent.error(image);

    expect(view.getByText(/task asset response failed to load/i)).toBeTruthy();
  });
});

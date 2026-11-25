import { withShellPlatform } from "@/test-utils/focused-fixture";
import type { ReactNode } from "react";
import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render as renderView, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { TaskDescriptionImageContext } from "./task-description-image-context";
import { TaskDescriptionImageNode } from "./task-description-image-node";

const render = (element: ReactNode) => renderView(element, { wrapper: QueryProvider });

describe("TaskDescriptionImageNode", () => {
  test("loads a linked GitHub issue image through the authenticated host request", async () => {
    const url = "https://github.com/user-attachments/assets/550e8400-e29b-41d4-a716-446655440000";
    const imageGet = mock(async () => ({
      mediaType: "image/png" as const,
      bytesBase64: "aW1hZ2U=",
    }));
    const connection = createTestClientConnection({ client: { issueImageGet: imageGet } });
    const view = render(
      <QueryProvider connection={connection}>
        <TaskDescriptionImageContext.Provider
          value={{
            previews: new Map(),
            renderContext: null,
            issueImageContext: {
              workspaceId: "workspace-1",
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
        workspaceId: "workspace-1",
        repoPath: "/workspace/repo",
        sourceId: "132",
        url,
      });
    } finally {
      view.unmount();
    }
  });

  test("does not resolve the same durable image again when its context object is recreated", async () => {
    const resolveTaskAssetSource = mock(async () => ({
      kind: "url" as const,
      src: "openducktor-task-asset://resolved",
    }));
    const shellPlatform = {
      ...createUnavailableShellBridge(),
      resolveTaskAssetSource,
    };
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
    const image = (renderContext: typeof context) =>
      withShellPlatform(
        <TaskDescriptionImageContext.Provider value={{ previews: new Map(), renderContext }}>
          <TaskDescriptionImageNode {...props} />
        </TaskDescriptionImageContext.Provider>,
        shellPlatform,
      );
    const view = await act(async () => render(image(context)));
    const initialImage = await view.findByRole("img", { name: "Architecture" });
    expect(initialImage.getAttribute("src")).toBe("openducktor-task-asset://resolved");

    await act(async () => view.rerender(image({ ...context })));

    expect(resolveTaskAssetSource).toHaveBeenCalledTimes(1);
    expect(view.getByRole("img", { name: "Architecture" })).toBe(initialImage);
  });

  test("shows the image error state when a resolved asset response fails to load", async () => {
    const shellPlatform = {
      ...createUnavailableShellBridge(),
      resolveTaskAssetSource: async () => ({
        kind: "url" as const,
        src: "openducktor-task-asset://missing",
      }),
    };
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
      withShellPlatform(
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
        shellPlatform,
      ),
    );

    const image = await waitFor(() => view.getByRole("img", { name: "Architecture" }));
    fireEvent.error(image);

    expect(view.getByText(/task asset response failed to load/i)).toBeTruthy();
  });
});

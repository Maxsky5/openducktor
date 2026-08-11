import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { TaskDescriptionImageContext } from "./task-description-image-context";
import { TaskDescriptionImageNode } from "./task-description-image-node";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("TaskDescriptionImageNode", () => {
  test("does not resolve the same durable image again when its context object is recreated", async () => {
    const resolveTaskAssetSrc = mock(async () => "openducktor-task-asset://resolved");
    configureShellBridge({
      ...createUnavailableShellBridge(),
      resolveTaskAssetSrc,
    });
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const props = {
      node: { attrs: { src: `odt-asset:${assetId}`, alt: "Architecture", title: null } },
      selected: false,
      updateAttributes: () => {},
    } as unknown as ReactNodeViewProps;
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
    } as unknown as ReactNodeViewProps;
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

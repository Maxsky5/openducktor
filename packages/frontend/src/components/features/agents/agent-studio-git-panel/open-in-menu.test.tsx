import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SystemOpenInToolInfo } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query-provider";
import { toRightPanelStorageKey } from "@/pages/agents/agents-page-selection";
import { host } from "@/state/operations/host";
import { withMockedToast } from "@/test-utils/mock-toast";
import { OpenInMenu } from "./open-in-menu";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("OpenInMenu", () => {
  let rendered: ReturnType<typeof render> | null = null;

  afterEach(async () => {
    if (rendered) {
      await act(async () => {
        rendered?.unmount();
      });
      rendered = null;
    }
    globalThis.localStorage.clear();
  });

  test("renders discovered tools with icons and dispatches the selected tool", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
          { toolId: "ghostty", iconDataUrl: "data:image/png;base64,ghostty" },
          { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
        ] satisfies SystemOpenInToolInfo[],
    );
    const onOpenInTool = mock(async () => {});
    host.systemListOpenInTools = systemListOpenInTools;
    const storageKey = toRightPanelStorageKey();

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={onOpenInTool}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-finder");
      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "Finder",
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-icon-finder")).toBeTruthy();
      expect(screen.getByTestId("agent-studio-git-open-in-icon-ghostty")).toBeTruthy();
      expect(screen.getByTestId("agent-studio-git-open-in-icon-zed")).toBeTruthy();
      expect(screen.queryByText("Files")).toBeNull();
      expect(screen.queryByText("Terminals")).toBeNull();
      expect(screen.queryByText("Editors & IDEs")).toBeNull();
      expect(screen.queryByTestId("agent-studio-git-open-in-item-finder")).toBeNull();
      expect(
        (screen.getByTestId("agent-studio-git-open-in-icon-zed") as HTMLImageElement).tagName,
      ).toBe("IMG");

      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-item-ghostty"));
      });

      expect(onOpenInTool).toHaveBeenCalledWith("ghostty");
      expect(globalThis.localStorage.getItem(storageKey)).toContain("ghostty");
      expect(systemListOpenInTools).toHaveBeenCalledTimes(1);
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("shows an actionable disabled reason when the target path is unavailable", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies SystemOpenInToolInfo[],
    );

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath={null}
              disabledReason="Builder worktree path is unavailable. Refresh the Git panel and try again."
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      const trigger = screen.getByTestId("agent-studio-git-open-in-trigger") as HTMLButtonElement;
      const disabledTrigger = screen.getByTestId("agent-studio-git-open-in-disabled-trigger");

      expect(trigger.disabled).toBe(true);
      expect(disabledTrigger).toBeTruthy();
      expect(
        screen.getByText(
          "Builder worktree path is unavailable. Refresh the Git panel and try again.",
          { selector: "span.sr-only" },
        ).textContent,
      ).toContain("Builder worktree path is unavailable. Refresh the Git panel and try again.");
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("disables the trigger even when the caller forgot to provide a disabled reason", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies SystemOpenInToolInfo[],
    );

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu contextMode="worktree" targetPath={null} disabledReason={null} />
          </TooltipProvider>
        </QueryProvider>,
      );

      const trigger = screen.getByTestId("agent-studio-git-open-in-trigger") as HTMLButtonElement;

      expect(trigger.disabled).toBe(true);
      expect(
        screen.getByText(
          "Builder worktree path is unavailable. Refresh the Git panel and try again.",
          { selector: "span.sr-only" },
        ).textContent,
      ).toContain("Builder worktree path is unavailable");
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("surfaces launch failures with a toast that names the selected tool", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const originalSystemListOpenInTools = host.systemListOpenInTools;
      host.systemListOpenInTools = mock(
        async () =>
          [
            { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
          ] satisfies SystemOpenInToolInfo[],
      );

      try {
        rendered = render(
          <QueryProvider useIsolatedClient>
            <TooltipProvider>
              <OpenInMenu
                contextMode="worktree"
                targetPath="/tmp/worktrees/task-24"
                disabledReason={null}
                onOpenInTool={async () => {
                  throw new Error("launch failed");
                }}
              />
            </TooltipProvider>
          </QueryProvider>,
        );

        await screen.findByTestId("agent-studio-git-open-in-icon-zed");
        await act(async () => {
          fireEvent.click(screen.getByTestId("agent-studio-git-open-in-default-button"));
          await Promise.resolve();
        });

        expect(toastErrorMock).toHaveBeenCalledWith("Failed to open in Zed", {
          description: "launch failed",
        });
      } finally {
        host.systemListOpenInTools = originalSystemListOpenInTools;
      }
    });
  });

  test("uses the persisted last-used tool as the default action and keeps only alternatives in the menu", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const storageKey = toRightPanelStorageKey();
    globalThis.localStorage.setItem(storageKey, JSON.stringify({ openInToolId: "zed" }));
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
          { toolId: "terminal", iconDataUrl: "data:image/png;base64,terminal" },
          { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
        ] satisfies SystemOpenInToolInfo[],
    );
    const onOpenInTool = mock(async () => {});

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={onOpenInTool}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-zed");
      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "Zed",
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-default-button"));
      });

      expect(onOpenInTool).toHaveBeenCalledWith("zed");

      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(screen.queryByTestId("agent-studio-git-open-in-item-zed")).toBeNull();
      expect(screen.getByTestId("agent-studio-git-open-in-item-finder")).toBeTruthy();
      expect(screen.getByTestId("agent-studio-git-open-in-item-terminal")).toBeTruthy();
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("retry forces a fresh discovery request after a discovery error", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const systemListOpenInTools = mock(async (forceRefresh = false) => {
      if (!forceRefresh) {
        throw new Error("initial discovery failed");
      }

      return [
        { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
      ] satisfies SystemOpenInToolInfo[];
    });
    host.systemListOpenInTools = systemListOpenInTools;

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await act(async () => {
        fireEvent.click(await screen.findByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-error")).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-icon-finder")).toBeTruthy();
      expect(systemListOpenInTools).toHaveBeenNthCalledWith(1);
      expect(systemListOpenInTools).toHaveBeenNthCalledWith(2, true);
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("retry surfaces a toast when refresh discovery also fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const originalSystemListOpenInTools = host.systemListOpenInTools;
      const systemListOpenInTools = mock(async () => {
        throw new Error("refresh discovery failed");
      });
      host.systemListOpenInTools = systemListOpenInTools;

      try {
        rendered = render(
          <QueryProvider useIsolatedClient>
            <TooltipProvider>
              <OpenInMenu
                contextMode="worktree"
                targetPath="/tmp/worktrees/task-24"
                disabledReason={null}
                onOpenInTool={async () => {}}
              />
            </TooltipProvider>
          </QueryProvider>,
        );

        await act(async () => {
          fireEvent.click(await screen.findByTestId("agent-studio-git-open-in-trigger"));
        });

        expect(await screen.findByTestId("agent-studio-git-open-in-error")).toBeTruthy();

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Retry" }));
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(toastErrorMock).toHaveBeenCalledWith("Failed to refresh supported apps", {
          description: "refresh discovery failed",
        });
      } finally {
        host.systemListOpenInTools = originalSystemListOpenInTools;
      }
    });
  });
});

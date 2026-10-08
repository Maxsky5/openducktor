import { expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createQueryClient } from "@/lib/query-client";
import {
  useWorkspaceComparisonChoice,
  workspaceComparisonChoices,
} from "./workspace-comparison-choices";

test("isolates session choices and retains them across navigation, query clearing, and remount", async () => {
  const client = createQueryClient();
  const owner = { workspaceId: "workspace-a", sessionId: "session-1" };
  const choice = { branch: "release", remote: "origin" };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(useWorkspaceComparisonChoice, { initialProps: owner, wrapper });
  try {
    await act(async () => {
      await hook.result.current.applyTarget(choice);
    });
    hook.rerender({ ...owner, sessionId: "session-2" });
    expect(hook.result.current.target).toBeUndefined();
    hook.rerender({ ...owner, workspaceId: "workspace-b" });
    expect(hook.result.current.target).toBeUndefined();
    client.clear();
    hook.rerender(owner);
    expect(hook.result.current.target).toEqual(choice);
    hook.unmount();
    const reopened = renderHook(useWorkspaceComparisonChoice, { initialProps: owner, wrapper });
    try {
      expect(reopened.result.current.target).toEqual(choice);
      await act(async () => {
        await reopened.result.current.applyTarget({ branch: "@{upstream}" });
      });
      expect(reopened.result.current.target).toBeUndefined();
    } finally {
      reopened.unmount();
    }
    expect(workspaceComparisonChoices(createQueryClient()).get(owner)).toBeUndefined();
  } finally {
    hook.unmount();
    client.clear();
  }
});

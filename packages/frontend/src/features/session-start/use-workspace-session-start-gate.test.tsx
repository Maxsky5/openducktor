import { expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useWorkspaceSessionStartGate } from "./use-workspace-session-start-gate";

test("clears the gate only when the workspace changes", () => {
  const { result, rerender } = renderHook(
    ({ workspaceId }: { workspaceId: string | null }) =>
      useWorkspaceSessionStartGate<string>(workspaceId),
    { initialProps: { workspaceId: "alpha" } },
  );
  const gate = result.current;
  let starts = 0;
  const start = (): Promise<string> => {
    starts += 1;
    return new Promise<string>(() => {});
  };

  void gate.run("task-1:spec", start);
  rerender({ workspaceId: "alpha" });
  void result.current.run("task-1:spec", start);
  expect(starts).toBe(1);

  rerender({ workspaceId: "beta" });
  void result.current.run("task-1:spec", start);
  expect(result.current).toBe(gate);
  expect(starts).toBe(2);
});

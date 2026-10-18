import { describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { MemoryRouter, useNavigate, useSearchParams } from "react-router";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { useTaskWorkflowDetailsSheet } from "./use-task-workflow-details-sheet";

enableReactActEnvironment();

const renderSheet = (initialEntry = "/kanban") => {
  const Router = ({ children }: PropsWithChildren): ReactElement => (
    <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
  );
  const view = renderHook(
    () => ({
      sheet: useTaskWorkflowDetailsSheet({ activeWorkspace: null, tasks: [] }),
      navigate: useNavigate(),
      setSearchParams: useSearchParams()[1],
    }),
    { wrapper: Router },
  );
  const handle = { openTask: mock((_taskId: string) => {}), close: mock(() => {}) };
  view.result.current.sheet.taskDetailsSheet.ref.current = handle;
  return { view, handle };
};

describe("useTaskWorkflowDetailsSheet", () => {
  test("opens the task in the sheet", () => {
    const { view, handle } = renderSheet();

    view.result.current.sheet.onOpenTaskDetails("odt-1");

    expect(handle.openTask).toHaveBeenCalledWith("odt-1");
  });

  test("closes the sheet when an action leaves the page, but not for a query change", async () => {
    const { view, handle } = renderSheet();

    await act(async () => view.result.current.setSearchParams({ task: "odt-1" }));
    expect(handle.close).not.toHaveBeenCalled();

    await act(async () => view.result.current.navigate("/sessions"));
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  test("closes the sheet when /sessions changes between Agent Studio and a workspace chat", async () => {
    const { view, handle } = renderSheet("/sessions?workspace=w-1&kind=task&task=odt-1");

    await act(async () =>
      view.result.current.setSearchParams({ workspace: "w-1", kind: "task", task: "odt-2" }),
    );
    expect(handle.close).not.toHaveBeenCalled();

    await act(async () => view.result.current.navigate("/sessions?workspace=w-1&kind=workspace"));
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
});

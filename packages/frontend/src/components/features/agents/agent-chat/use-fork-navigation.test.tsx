import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { useForkNavigation } from "./use-fork-navigation";

const child = { kind: "workspace_session" as const, workspaceId: "workspace", sessionId: "child" };

test("opens a current fork but does not move a user who left the initiating view", () => {
  let complete: (() => void) | null = null;
  function Harness({ active }: { active: boolean }) {
    const location = useLocation();
    const navigate = useNavigate();
    const capture = useForkNavigation("source", active);
    return (
      <>
        <output>
          {location.pathname}
          {location.search}
        </output>
        <button
          type="button"
          onClick={() => {
            const open = capture();
            complete = () => {
              open(child, "/repo");
            };
          }}
        >
          Start fork
        </button>
        <button
          type="button"
          onClick={() => {
            void navigate("/elsewhere");
          }}
        >
          Leave
        </button>
        <button
          type="button"
          onClick={() => {
            complete?.();
          }}
        >
          Complete fork
        </button>
      </>
    );
  }
  const content = (active: boolean) => (
    <MemoryRouter initialEntries={["/sessions?session=source"]}>
      <SessionViewContext value={{ id: "view", isActive: active }}>
        <Harness active={active} />
      </SessionViewContext>
    </MemoryRouter>
  );
  const view = render(content(true));
  try {
    fireEvent.click(view.getByText("Start fork"));
    fireEvent.click(view.getByText("Leave"));
    fireEvent.click(view.getByText("Complete fork"));
    expect(view.getByRole("status").textContent).toBe("/elsewhere");
    fireEvent.click(view.getByText("Start fork"));
    view.rerender(content(false));
    view.rerender(content(true));
    fireEvent.click(view.getByText("Complete fork"));
    expect(view.getByRole("status").textContent).toBe("/elsewhere");
    fireEvent.click(view.getByText("Start fork"));
    fireEvent.click(view.getByText("Complete fork"));
    expect(view.getByRole("status").textContent).toBe(
      "/sessions?workspace=workspace&kind=workspace&session=child",
    );
  } finally {
    view.unmount();
  }
});

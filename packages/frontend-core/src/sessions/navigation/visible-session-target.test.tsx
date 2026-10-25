import "../../test-support/dom-environment";
import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { memo, type ReactElement, useMemo } from "react";
import { SessionViewContext } from "./session-view-context";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "./session-navigation-target";
import {
  usePublishVisibleSessionTarget,
  useVisibleSessionControls,
  useVisibleSessionTarget,
  VisibleSessionTargetProvider,
} from "./visible-session-target";

function Publisher({ sessionId }: { sessionId: string }): null {
  const target = useMemo<SessionNavigationTarget>(
    () => ({ kind: "workspace_session", workspaceId: "w", sessionId }),
    [sessionId],
  );
  usePublishVisibleSessionTarget(target);
  return null;
}

function Reader(): ReactElement {
  const target = useVisibleSessionTarget();
  return (
    <output aria-label="Visible target">
      {target ? sessionNavigationTargetKey(target) : "none"}
    </output>
  );
}

const renderPublisher = (sessionId: string | null) => (
  <VisibleSessionTargetProvider>
    {sessionId ? <Publisher sessionId={sessionId} /> : null}
    <Reader />
  </VisibleSessionTargetProvider>
);

test("publishes the visible target while content is mounted and clears it on unmount", () => {
  const view = render(renderPublisher("chat-1"));
  expect(view.getByLabelText("Visible target").textContent).toBe("workspace_session:w:chat-1");

  view.rerender(renderPublisher("chat-2"));
  expect(view.getByLabelText("Visible target").textContent).toBe("workspace_session:w:chat-2");

  view.rerender(renderPublisher(null));
  expect(view.getByLabelText("Visible target").textContent).toBe("none");
});

test("requires the provider", () => {
  expect(() => render(<Reader />)).toThrow("VisibleSessionTargetProvider is missing.");
});

const FIRST_VIEW = { id: "first", isActive: true };
const SECOND_VIEW = { id: "second", isActive: true };

test("a publisher does not render again when another view publishes", () => {
  let firstRenders = 0;
  const CountedPublisher = memo(function CountedPublisher(): null {
    firstRenders += 1;
    const target = useMemo<SessionNavigationTarget>(
      () => ({ kind: "workspace_session", workspaceId: "w", sessionId: "chat-1" }),
      [],
    );
    usePublishVisibleSessionTarget(target);
    return null;
  });
  const renderViews = (second: string | null) => (
    <VisibleSessionTargetProvider>
      <SessionViewContext value={FIRST_VIEW}>
        <CountedPublisher />
      </SessionViewContext>
      {second ? (
        <SessionViewContext value={SECOND_VIEW}>
          <Publisher sessionId={second} />
        </SessionViewContext>
      ) : null}
      <Reader />
    </VisibleSessionTargetProvider>
  );
  const view = render(renderViews(null));
  const rendersBefore = firstRenders;

  view.rerender(renderViews("chat-2"));

  expect(view.getByLabelText("Visible target").textContent).toBe("workspace_session:w:chat-2");
  expect(firstRenders).toBe(rendersBefore);
  view.unmount();
});

test("reads the committed target without a render", () => {
  let controls: ReturnType<typeof useVisibleSessionControls> | null = null;
  function Controls(): null {
    controls = useVisibleSessionControls();
    return null;
  }
  const renderView = (sessionId: string | null) => (
    <VisibleSessionTargetProvider>
      <Controls />
      {sessionId ? <Publisher sessionId={sessionId} /> : null}
    </VisibleSessionTargetProvider>
  );
  const view = render(renderView("chat-1"));
  const readKey = () => {
    const visible = controls?.readVisible() ?? null;
    return visible ? sessionNavigationTargetKey(visible.target) : null;
  };
  expect(readKey()).toBe("workspace_session:w:chat-1");
  view.rerender(renderView("chat-2"));
  expect(readKey()).toBe("workspace_session:w:chat-2");
  view.rerender(renderView(null));
  expect(readKey()).toBeNull();
  view.unmount();
});

test("renders only the readers when content publishes its target", () => {
  const target: SessionNavigationTarget = {
    kind: "workspace_session",
    workspaceId: "w",
    sessionId: "chat-1",
  };
  let publisherRenders = 0;
  function CountedPublisher(): null {
    publisherRenders += 1;
    usePublishVisibleSessionTarget(target);
    return null;
  }
  const view = render(
    <VisibleSessionTargetProvider>
      <CountedPublisher />
      <Reader />
    </VisibleSessionTargetProvider>,
  );

  expect(view.getByLabelText("Visible target").textContent).toBe("workspace_session:w:chat-1");
  expect(publisherRenders).toBe(1);
});

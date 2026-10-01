import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { type ReactElement, useMemo } from "react";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "./session-navigation-target";
import {
  usePublishVisibleSessionTarget,
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
  expect(screen.getByLabelText("Visible target").textContent).toBe("workspace_session:w:chat-1");

  view.rerender(renderPublisher("chat-2"));
  expect(screen.getByLabelText("Visible target").textContent).toBe("workspace_session:w:chat-2");

  view.rerender(renderPublisher(null));
  expect(screen.getByLabelText("Visible target").textContent).toBe("none");
});

test("requires the provider", () => {
  expect(() => render(<Reader />)).toThrow("VisibleSessionTargetProvider is missing.");
});

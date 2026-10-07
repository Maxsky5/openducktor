import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { LegacySessionsRedirect } from "./legacy-sessions-redirect";

function LocationProbe(): ReactElement {
  const location = useLocation();
  return (
    <output aria-label="Current location">
      {`${location.pathname}${location.search}${location.hash}|${JSON.stringify(location.state)}`}
    </output>
  );
}

const renderRedirect = (entry: {
  pathname: string;
  search: string;
  hash?: string;
  state?: unknown;
}) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/workflows" element={<LegacySessionsRedirect kind="task" />} />
        <Route path="/chats" element={<LegacySessionsRedirect kind="workspace" />} />
        <Route path="/sessions" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

test("keeps a task workflow link's task, role, session, hash, and state on the Sessions page", async () => {
  renderRedirect({
    pathname: "/workflows",
    search: "?task=task-1&session=native&agent=build",
    hash: "#transcript",
    state: { notificationTarget: "kept" },
  });

  expect((await screen.findByLabelText("Current location")).textContent).toBe(
    '/sessions?task=task-1&session=native&agent=build&kind=task#transcript|{"notificationTarget":"kept"}',
  );
});

test("keeps a chat link's saved session ID for the workspace session content", async () => {
  renderRedirect({ pathname: "/chats", search: "?session=chat-1&create=session" });

  expect((await screen.findByLabelText("Current location")).textContent).toBe(
    "/sessions?session=chat-1&create=session&kind=workspace|null",
  );
});

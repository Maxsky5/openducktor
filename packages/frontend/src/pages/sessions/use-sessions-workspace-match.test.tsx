import { expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, startTransition, useRef, useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { SessionView } from "./session-view-resolution";
import { useSessionsWorkspaceMatch } from "./use-sessions-workspace-match";

const alpha = createWorkspaceRecordFixture({ workspaceId: "alpha", workspaceName: "Alpha" });
const beta = createWorkspaceRecordFixture({
  workspaceId: "beta",
  workspaceName: "Beta",
  repoPath: "/beta",
  isActive: false,
});
const gamma = createWorkspaceRecordFixture({
  workspaceId: "gamma",
  workspaceName: "Gamma",
  repoPath: "/gamma",
  isActive: false,
});
const recordsById = new Map([alpha, beta, gamma].map((record) => [record.workspaceId, record]));
const closed = createWorkspaceRecordFixture({
  workspaceId: "closed",
  workspaceName: "Closed",
  repoPath: "/closed",
  isActive: false,
});

function Probe({ keptViews }: { keptViews: readonly SessionView[] }): ReactElement {
  const location = useLocation();
  const workspaceMatch = useSessionsWorkspaceMatch(keptViews);
  return (
    <>
      <output aria-label="Address">{`${location.pathname}${location.search}`}</output>
      <output aria-label="Address state">{JSON.stringify(location.state)}</output>
      <output aria-label="State">
        {workspaceMatch.kind === "failed"
          ? `failed: ${workspaceMatch.message}`
          : workspaceMatch.kind}
      </output>
      {workspaceMatch.kind === "failed" && workspaceMatch.retry ? (
        <button type="button" onClick={workspaceMatch.retry}>
          Retry
        </button>
      ) : null}
    </>
  );
}

const renderWorkspaceMatch = ({
  initialEntry,
  selectWorkspace = async () => true,
  keptViews = [],
}: {
  initialEntry: string;
  keptViews?: readonly SessionView[];
  /** Resolves false when another workspace action replaced the switch before it applied. */
  selectWorkspace?: (workspaceId: string) => Promise<boolean>;
}) => {
  function Harness(): ReactElement {
    const [active, setActive] = useState<WorkspaceRecord>(alpha);
    const navigate = useNavigate();
    // As in the app, a later selection replaces an earlier one that did not apply yet.
    const versionRef = useRef(0);
    const state = createWorkspaceStateFixture({
      workspaces: [alpha, beta, gamma],
      closedWorkspaces: [closed],
      activeWorkspace: active,
      selectWorkspace: async (workspaceId, onSelected) => {
        const version = ++versionRef.current;
        if ((await selectWorkspace(workspaceId)) && versionRef.current === version) {
          startTransition(() => {
            setActive(recordsById.get(workspaceId) ?? alpha);
            onSelected?.();
          });
        }
      },
    });
    return (
      <WorkspaceStateContext.Provider value={state}>
        <button type="button" onClick={() => setActive(beta)}>
          Select Beta from the rail
        </button>
        <button type="button" onClick={() => setActive(gamma)}>
          Select Gamma from the rail
        </button>
        <button
          type="button"
          onClick={() => navigate("/sessions?workspace=beta&kind=workspace&session=chat-1")}
        >
          Open a Beta chat
        </button>
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
        <button type="button" onClick={() => navigate(1)}>
          Forward
        </button>
        <Probe keptViews={keptViews} />
      </WorkspaceStateContext.Provider>
    );
  }
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Harness />
    </MemoryRouter>,
  );
};

const address = () => screen.getByLabelText("Address").textContent;
const state = () => screen.getByLabelText("State").textContent;

test("names the active workspace in an address that has none", async () => {
  renderWorkspaceMatch({ initialEntry: "/sessions?kind=task&task=t-1" });

  await waitFor(() => expect(address()).toBe("/sessions?kind=task&task=t-1&workspace=alpha"));
  expect(state()).toBe("ready");
});

test("opens the workspace that a new address names and keeps the requested target", async () => {
  const selectWorkspace = mock(async (_workspaceId: string) => true);
  renderWorkspaceMatch({
    initialEntry: "/sessions?workspace=beta&kind=workspace&session=chat-1",
    selectWorkspace,
  });

  await waitFor(() => expect(state()).toBe("ready"));
  expect(selectWorkspace).toHaveBeenCalledWith("beta");
  expect(address()).toBe("/sessions?workspace=beta&kind=workspace&session=chat-1");
});

test("follows a workspace change from elsewhere and drops the old selection", async () => {
  renderWorkspaceMatch({ initialEntry: "/sessions?workspace=alpha&kind=task&task=t-1" });
  await waitFor(() => expect(state()).toBe("ready"));

  fireEvent.click(screen.getByRole("button", { name: "Select Beta from the rail" }));

  await waitFor(() => expect(address()).toBe("/sessions?workspace=beta&kind=task"));
  expect(state()).toBe("ready");
});

test("returns to the kept address of the workspace that the rail selects", async () => {
  const sessionless = { sessionlessTask: { workspaceId: "beta", taskId: "t-2", role: "build" } };
  const keptView = (kind: SessionView["kind"], search: string): SessionView => ({
    id: `${kind}-view`,
    search,
    state: sessionless,
    kind,
    workspace: beta,
    scope: [],
  });
  renderWorkspaceMatch({
    initialEntry: "/sessions?workspace=alpha&kind=task&task=t-1",
    keptViews: [
      keptView("task", "?workspace=beta&kind=task&task=t-2&agent=build&attention=permission"),
      keptView("workspace", "?workspace=beta&kind=workspace&session=chat-1"),
    ],
  });
  await waitFor(() => expect(state()).toBe("ready"));

  fireEvent.click(screen.getByRole("button", { name: "Select Beta from the rail" }));

  await waitFor(() =>
    expect(address()).toBe("/sessions?workspace=beta&kind=task&task=t-2&agent=build"),
  );
  expect(screen.getByLabelText("Address state").textContent).toBe(JSON.stringify(sessionless));
  expect(state()).toBe("ready");
});

test("reports a closed workspace instead of opening another conversation", async () => {
  renderWorkspaceMatch({ initialEntry: "/sessions?workspace=closed&kind=task&task=t-1" });

  await waitFor(() =>
    expect(state()).toBe("failed: Closed is closed. Reopen it to see its sessions."),
  );
  expect(address()).toBe("/sessions?workspace=closed&kind=task&task=t-1");
});

test("reports a failed workspace switch and retries it on request", async () => {
  let attempts = 0;
  renderWorkspaceMatch({
    initialEntry: "/sessions?workspace=beta&kind=task&task=t-1",
    selectWorkspace: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Workspace selection failed.");
      return true;
    },
  });

  await waitFor(() => expect(state()).toBe("failed: Workspace selection failed."));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });

  await waitFor(() => expect(state()).toBe("ready"));
  expect(attempts).toBe(2);
  expect(address()).toBe("/sessions?workspace=beta&kind=task&task=t-1");
});

test("follows a rail selection made while the address waits for its workspace", async () => {
  let finishSwitch: (applied: boolean) => void = () => {};
  const selectWorkspace = mock(
    (_workspaceId: string) =>
      new Promise<boolean>((resolve) => {
        finishSwitch = resolve;
      }),
  );
  renderWorkspaceMatch({
    initialEntry: "/sessions?workspace=beta&kind=task&task=t-1",
    selectWorkspace,
  });
  await waitFor(() => expect(selectWorkspace).toHaveBeenCalledTimes(1));
  expect(state()).toBe("pending");

  fireEvent.click(screen.getByRole("button", { name: "Select Gamma from the rail" }));
  await act(async () => {
    finishSwitch(false);
  });

  await waitFor(() => expect(address()).toBe("/sessions?workspace=gamma&kind=task"));
  expect(state()).toBe("ready");
  expect(selectWorkspace).toHaveBeenCalledTimes(1);
});

test("offers a retry when another workspace action replaced the switch", async () => {
  let attempts = 0;
  renderWorkspaceMatch({
    initialEntry: "/sessions?workspace=beta&kind=task&task=t-1",
    selectWorkspace: async () => {
      attempts += 1;
      return attempts > 1;
    },
  });

  await waitFor(() =>
    expect(state()).toBe("failed: Another workspace action interrupted opening this workspace."),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });

  await waitFor(() => expect(state()).toBe("ready"));
  expect(attempts).toBe(2);
  expect(address()).toBe("/sessions?workspace=beta&kind=task&task=t-1");
});

test("Back during a pending switch keeps the earlier workspace and its address", async () => {
  const finish = new Map<string, (applied: boolean) => void>();
  const selectWorkspace = mock(
    (workspaceId: string) =>
      new Promise<boolean>((resolve) => {
        finish.set(workspaceId, resolve);
      }),
  );
  renderWorkspaceMatch({
    initialEntry: "/sessions?workspace=alpha&kind=workspace&session=chat-0",
    selectWorkspace,
  });
  await waitFor(() => expect(state()).toBe("ready"));

  fireEvent.click(screen.getByRole("button", { name: "Open a Beta chat" }));
  await waitFor(() => expect(selectWorkspace).toHaveBeenCalledWith("beta"));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(selectWorkspace).toHaveBeenLastCalledWith("alpha"));
  await act(async () => {
    finish.get("beta")?.(true);
    finish.get("alpha")?.(true);
  });

  expect(address()).toBe("/sessions?workspace=alpha&kind=workspace&session=chat-0");
  expect(state()).toBe("ready");

  // The cancelled address opens its workspace again.
  fireEvent.click(screen.getByRole("button", { name: "Forward" }));
  await waitFor(() => expect(selectWorkspace).toHaveBeenCalledTimes(3));
  expect(selectWorkspace).toHaveBeenLastCalledWith("beta");
  await act(async () => {
    finish.get("beta")?.(true);
  });
  await waitFor(() => expect(state()).toBe("ready"));
  expect(address()).toBe("/sessions?workspace=beta&kind=workspace&session=chat-1");
});

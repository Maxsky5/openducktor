import { expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
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

function Probe(): ReactElement {
  const location = useLocation();
  const workspaceMatch = useSessionsWorkspaceMatch();
  return (
    <>
      <output aria-label="Address">{`${location.pathname}${location.search}`}</output>
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
}: {
  initialEntry: string;
  /** Resolves false when another workspace action replaced the switch before it applied. */
  selectWorkspace?: (workspaceId: string) => Promise<boolean>;
}) => {
  function Harness(): ReactElement {
    const [active, setActive] = useState<WorkspaceRecord>(alpha);
    const state = createWorkspaceStateFixture({
      workspaces: [alpha, beta, gamma],
      closedWorkspaces: [closed],
      activeWorkspace: active,
      selectWorkspace: async (workspaceId) => {
        if (await selectWorkspace(workspaceId)) setActive(recordsById.get(workspaceId) ?? alpha);
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
        <Probe />
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

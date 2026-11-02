import { workspaceRefFixture } from "../test-support/workspace-ref-fixture";
import type { WorkspaceRef } from "@openducktor/contracts";
import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { IsolatedQueryWrapper } from "../test-support/isolated-query-wrapper";
import { createHookHarness } from "../test-support/react-hook-harness";
import { createDeferred } from "../test-support/shared-test-fixtures";
import type { TaskStreamController } from "./task-stream-controller";
import {
  type TaskStreamControllerFactory,
  type TaskStreamStart,
  useHostTaskStream,
} from "./use-host-task-stream";

type StreamProps = Parameters<typeof useHostTaskStream>[0];

const scope = (repoPath: string) => workspaceRefFixture(repoPath, repoPath.slice(1));

const workspaces = (...repoPaths: string[]) => repoPaths.map(scope);

const recordingEvents = (log: string[]): StreamProps["events"] => ({
  onDegraded: (description) => log.push(`degraded: ${description}`),
  onWorkspaceFailures: (description) => log.push(`failures: ${description}`),
  onUnavailable: (cause) => log.push(`unavailable: ${String(cause)}`),
  onWorkspaceReleased: (repoPath) => log.push(`released event: ${repoPath.repoPath}`),
  trackStart: () => {
    log.push("track");
    return (start: TaskStreamStart) => log.push(`start: ${start}`);
  },
});

/** A factory whose controllers record their calls and keep the input of the last one. */
const fakeFactory = (log: string[], start: () => Promise<void> = async () => {}) => {
  const inputs: Parameters<TaskStreamControllerFactory>[0][] = [];
  const createController: TaskStreamControllerFactory = (input) => {
    inputs.push(input);
    const controller: TaskStreamController = {
      start,
      stop: async () => {
        log.push("stop");
      },
      releaseWorkspace: async (repoPath) => {
        log.push(`release: ${repoPath.repoPath}`);
      },
    };
    return controller;
  };
  return { createController, inputs };
};

const renderStream = (props: StreamProps) =>
  createHookHarness((current: StreamProps) => useHostTaskStream(current), props, {
    wrapper: IsolatedQueryWrapper,
  });

describe("useHostTaskStream", () => {
  test("starts one controller for the open workspaces and stops it on unmount", async () => {
    const log: string[] = [];
    const { createController, inputs } = fakeFactory(log);
    const harness = renderStream({
      openWorkspaces: workspaces("/repo-a"),
      activeWorkspaceId: "repo-b",
      activeRepoPath: "/repo-b",
      createController,
      events: recordingEvents(log),
    });
    await harness.mount();
    try {
      expect(harness.getLatest()).toEqual([scope("/repo-a"), scope("/repo-b")]);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]?.getOpenRepoPaths()).toEqual([scope("/repo-a"), scope("/repo-b")]);
      expect(inputs[0]?.getActiveRepoPath()).toEqual(scope("/repo-b"));
      expect(log).toEqual(["track", "start: started"]);
    } finally {
      await harness.unmount();
    }
    expect(log).toEqual(["track", "start: started", "start: stopped", "stop"]);
  });

  test("releases a workspace that closed, and keeps the stream for new callbacks", async () => {
    const log: string[] = [];
    const { createController, inputs } = fakeFactory(log);
    const props: StreamProps = {
      openWorkspaces: workspaces("/repo-a", "/repo-b"),
      activeWorkspaceId: "repo-a",
      activeRepoPath: "/repo-a",
      createController,
      events: recordingEvents(log),
    };
    const harness = renderStream(props);
    await harness.mount();
    try {
      await harness.update({
        ...props,
        openWorkspaces: workspaces("/repo-a"),
        events: recordingEvents(log),
      });
      expect(inputs).toHaveLength(1);
      expect(inputs[0]?.getOpenRepoPaths()).toEqual([scope("/repo-a")]);
      expect(log).toEqual([
        "track",
        "start: started",
        "released event: /repo-b",
        "release: /repo-b",
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("describes the stream failures for the platform", async () => {
    const log: string[] = [];
    const start = createDeferred<void>();
    const { createController, inputs } = fakeFactory(log, () => start.promise);
    const harness = renderStream({
      openWorkspaces: workspaces("/repo-a"),
      activeWorkspaceId: "workspace-1",
      activeRepoPath: null,
      createController,
      events: recordingEvents(log),
    });
    await harness.mount();
    try {
      inputs[0]?.onDegraded(new Error("Stream gap"));
      inputs[0]?.onWorkspaceFailures(
        new Map<WorkspaceRef, unknown>([
          [scope("/repo-a"), new Error("Read failed")],
          [scope("/repo-b"), new Error("Host offline")],
        ]),
      );
      await harness.run(() => {
        start.reject("Remote control is off");
      });
      expect(log).toEqual([
        "track",
        "degraded: Stream gap",
        "failures: repo-a (/repo-a): Read failed\nrepo-b (/repo-b): Host offline",
        "start: unavailable",
        "unavailable: Remote control is off",
      ]);
    } finally {
      await harness.unmount();
    }
  });
});

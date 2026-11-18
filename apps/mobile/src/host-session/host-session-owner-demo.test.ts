import { afterEach, describe, expect, test } from "bun:test";
import { createTextSegment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { createDemoSessionAdapter } from "../demo/demo-session-adapter";
import { SAVED_HOSTS_KEY } from "../device-data/device-records";
import {
  createMemoryDeviceStore,
  createMemoryHostStores,
  createRecordingFeedback,
} from "../test-support/memory-device-store";
import {
  createHostSessionOwner,
  type DemoHostSession,
  type HostSessionDependencies,
  type HostSessionOwner,
} from "./host-session-owner";

const SAVED_RECORD = JSON.stringify({
  activeHostId: null,
  hosts: [
    { id: "saved-1", endpoint: "http://100.64.0.7:14328", label: "Studio", shell: "electron" },
  ],
});

const owners: HostSessionOwner[] = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    const state = owner.getState();
    if (state.status === "active" && state.session.kind === "demo")
      await release(owner, () => owner.exitDemo());
  }
});

/** A demo owner whose real host access fails at once, so a test sees each attempt to use it. */
const setup = () => {
  const appStore = createMemoryDeviceStore({ [SAVED_HOSTS_KEY]: SAVED_RECORD });
  const hostStores = createMemoryHostStores();
  const realAccess: string[] = [];
  const feedback = createRecordingFeedback();
  const lifetimes: AbortSignal[] = [];
  const dependencies: HostSessionDependencies = {
    appStore,
    openHostStore: (hostId) => {
      realAccess.push(`store:${hostId}`);
      return hostStores.open(hostId);
    },
    deleteHostStore: async (hostId) => {
      realAccess.push(`delete:${hostId}`);
      await hostStores.remove(hostId);
    },
    openAuthorizationStore: (hostId) => {
      realAccess.push(`credentials:${hostId}`);
      return hostStores.authorization(hostId);
    },
    createTransport: () => {
      realAccess.push("transport");
      throw new Error("The test host has no network.");
    },
    createHostId: () => "host-new",
    appVersion: "mobile-test",
    feedback,
    createAttachmentStager: () => async () => {
      throw new Error("The test stages no attachment.");
    },
    startLifecycle: () => {
      throw new Error("The demo starts no connection lifecycle.");
    },
    createDemoSession: (lifetime) => {
      lifetimes.push(lifetime);
      return createDemoSessionAdapter(lifetime);
    },
  };
  const owner = createHostSessionOwner(dependencies);
  owners.push(owner);
  owner.start();
  return { owner, appStore, hostStores, realAccess, feedback, lifetimes };
};

const demoSession = (owner: HostSessionOwner): DemoHostSession => {
  const state = owner.getState();
  if (state.status !== "active" || state.session.kind !== "demo")
    throw new Error(`The owner is ${state.status}, not in the demo.`);
  return state.session;
};

/** Runs a reset or an exit and acknowledges the unmount of the demo tree, as the app does. */
const release = async (owner: HostSessionOwner, run: () => Promise<void>, failure?: Error) => {
  const { sessionKey } = demoSession(owner);
  const stop = owner.subscribe(() => {
    if (owner.getState().status !== "switching") return;
    stop();
    queueMicrotask(() => owner.acknowledgeDemoTreeRelease(sessionKey, failure));
  });
  await run();
};

describe("host session owner demo", () => {
  test("opens the demo without any saved host, credential, transport, or device write", async () => {
    const { owner, appStore, realAccess } = setup();
    const before = new Map(appStore.values);
    await owner.enterDemo();
    const session = demoSession(owner);
    const state = owner.getState();
    expect(state.status === "active" && state.hosts).toEqual([]);
    expect(session.host.label).toBe("Demo host");
    // Demo drafts live in memory: a save writes no device store.
    session.connection.drafts.chat.set(
      { workspaceId: "fieldnotes", workspaceSessionId: "chat-1" },
      null,
      {
        segments: [createTextSegment("A demo draft")],
        attachments: [],
      },
    );
    await session.connection.saveDrafts();
    expect(realAccess).toEqual([]);
    expect(appStore.values).toEqual(before);
  });

  test("resets to fresh sample data and ends every event of the old demo", async () => {
    const { owner, feedback, lifetimes } = setup();
    await owner.enterDemo();
    const first = demoSession(owner);
    const created = await first.connection.host.client.taskCreate(
      { workspaceId: "fieldnotes", repoPath: "/Users/sam/code/fieldnotes" },
      { title: "A demo change", issueType: "task", priority: 2 },
    );
    await release(owner, () => owner.resetDemo());
    const second = demoSession(owner);
    expect(second.sessionKey).not.toBe(first.sessionKey);
    expect(lifetimes[0]?.aborted).toBe(true);
    expect(feedback.messages).toContainEqual({ kind: "success", message: "Demo reset" });
    const ids = await second.connection.host.client.taskIdsList({
      workspaceId: "fieldnotes",
      repoPath: "/Users/sam/code/fieldnotes",
    });
    expect(ids).not.toContain(created.id);
    await expect(first.connection.host.client.workspaceList()).rejects.toThrow("The demo ended");
  });

  test("exits to host selection with the saved hosts unchanged", async () => {
    const { owner, appStore, realAccess } = setup();
    const before = new Map(appStore.values);
    await owner.enterDemo();
    await release(owner, () => owner.exitDemo());
    const state = owner.getState();
    expect(state.status).toBe("no_host");
    expect(state.status === "no_host" && state.hosts.map((host) => host.label)).toEqual(["Studio"]);
    expect(appStore.values).toEqual(before);
    expect(realAccess).toEqual([]);
  });

  test("shows a cleanup failure on host selection and opens no new demo", async () => {
    const { owner, feedback } = setup();
    await owner.enterDemo();
    await release(owner, () => owner.resetDemo(), new Error("A preview file stayed."));
    expect(owner.getState().status).toBe("no_host");
    expect(feedback.messages).toContainEqual({
      kind: "error",
      message: "The demo did not close cleanly",
    });
    expect(feedback.messages.some((message) => message.message === "Demo reset")).toBe(false);
  });

  test("keeps real host commands closed while the demo is open", async () => {
    const { owner, realAccess } = setup();
    await owner.enterDemo();
    await expect(owner.addHost("http://100.64.0.9:14328")).rejects.toThrow("Exit the demo");
    await expect(owner.selectHost("saved-1")).rejects.toThrow("Exit the demo");
    expect(realAccess).toEqual([]);
  });

  test("does not open the demo while a host connection is in progress", async () => {
    const { owner } = setup();
    const attempt = owner.addHost("http://100.64.0.9:14328").catch(() => {});
    await expect(owner.enterDemo()).rejects.toThrow("A host connection is in progress");
    await attempt;
    expect(owner.getState().status).toBe("no_host");
  });
});

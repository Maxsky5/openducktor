import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES,
  toAgentChatDraftStorageKey,
} from "@openducktor/frontend-core/drafts/agent-chat-draft-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import * as appModule from "./App";
import { HostSwitcher } from "./components/layout/host-connection";
import * as feedback from "./components/features/remote-control/connection-feedback";
import { readHostTarget } from "./lib/host-location";
import { bootstrapOpenDucktorShell } from "./shell-bootstrap";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";

type HappyDomWindow = typeof window & { happyDOM: { setURL(url: string): void } };

const draftIdentity = { workspaceId: "workspace-1", workspaceSessionId: "session-1" };
const draftWithText = (text: string) => ({
  segments: [{ id: "text-1", kind: "text" as const, text }],
});

const events: string[] = [];
let connection: ClientConnection | null = null;

// The bootstrap renders this probe in place of the app, so the test can read its connection.
function HostSwitchProbe() {
  const current = useClientConnection();
  useEffect(() => {
    connection = current;
    return () => {
      events.push("app unmounted");
    };
  }, [current]);
  return <HostSwitcher />;
}

let root: HTMLElement;
let connectedView: ReturnType<typeof spyOn>;
beforeEach(() => {
  // The Connected view waits one second. These tests check the switch order, not the time.
  connectedView = spyOn(feedback, "waitForConnectedView").mockResolvedValue();
  // SAFETY: The test preload registers happy-dom, which adds `happyDOM` to the global window.
  (window as HappyDomWindow).happyDOM.setURL("http://localhost/");
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  connectedView.mockRestore();
  // A pagehide event that does not keep the page in the cache removes the bootstrap listeners.
  window.dispatchEvent(new Event("pagehide"));
  root.remove();
  localStorage.clear();
  // SAFETY: The test preload registers happy-dom, which adds `happyDOM` to the global window.
  (window as HappyDomWindow).happyDOM.setURL("about:blank");
  events.length = 0;
  connection = null;
});

const currentTarget = () => readHostTarget(new URL(window.location.href), true);

/** Submits a host address. The stubbed Connected view does not wait. */
const switchHost = async (): Promise<void> => {
  const input = await screen.findByLabelText("Host address");
  fireEvent.change(input, { target: { value: "https://host.test" } });
  const form = screen.getByRole("button", { name: "Switch host" }).closest("form");
  if (!form) throw new Error("The host picker has no form.");
  await act(async () => {
    fireEvent.submit(form);
  });
};

const releasedBridge = (event: string) =>
  createShellBridgeFixture({
    client: {
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      // An attachment upload that does not end, such as a stalled network request.
      workspaceStageLocalAttachment: () => new Promise(() => {}),
    },
    bridge: {
      dispose: async () => {
        events.push(event);
      },
    },
  });

const mountShell = async (
  navigate: () => Promise<void>,
  remote?: { defaultEndpoint: string },
  confirmRemoteAccess: (
    endpoint: string,
    pairingCode: string | undefined,
  ) => Promise<void> = async () => {},
): Promise<ClientConnection> => {
  await act(async () => {
    await bootstrapOpenDucktorShell({
      createShellBridge: () => releasedBridge("local host released"),
      hosts: {
        localHost: "web",
        createRemoteBridge: remote
          ? () => releasedBridge("host released")
          : () => {
              throw new Error("A host switch reloads the page before it connects.");
            },
        confirmRemoteAccess,
        navigate,
        ...remote,
      },
      rootElement: root,
    });
  });
  await waitFor(() => expect(connection).not.toBeNull());
  const mounted = connection;
  if (!mounted) throw new Error("The app did not mount.");
  // StrictMode runs the effect cleanup of the probe once at mount.
  events.length = 0;
  fireEvent.click(screen.getByRole("button", { name: /^Host connection:/ }));
  return mounted;
};

const oversizedDraft = () => draftWithText("x".repeat(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES));

test("a host switch saves drafts, unmounts the app, and releases the host before it reloads", async () => {
  const appSpy = spyOn(appModule, "App").mockImplementation(HostSwitchProbe);
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  const navigate = mock(async () => {
    events.push("navigated");
  });
  try {
    const mounted = await mountShell(navigate);
    // A draft that is too large to save keeps the page, the draft, and the selected host.
    mounted.drafts.chat.set(draftIdentity, null, oversizedDraft());
    await switchHost();

    expect(await screen.findByText(/Could not save a chat draft\./)).toBeDefined();
    expect(events).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(currentTarget()).toEqual({ kind: "local" });

    mounted.drafts.chat.set(draftIdentity, null, draftWithText("Keep this draft"));
    await switchHost();

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["app unmounted", "local host released", "navigated"]);
    expect(localStorage.getItem(toAgentChatDraftStorageKey(draftIdentity))).toContain(
      "Keep this draft",
    );
    expect(currentTarget()).toEqual({ kind: "remote", endpoint: "https://host.test" });
  } finally {
    appSpy.mockRestore();
    consoleError.mockRestore();
  }
});

test("a remote host switch does not wait for drafts or uploads that only live in page memory", async () => {
  const appSpy = spyOn(appModule, "App").mockImplementation(HostSwitchProbe);
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  const navigate = mock(async () => {
    events.push("navigated");
  });
  try {
    const mounted = await mountShell(navigate, { defaultEndpoint: "https://first.test" });
    mounted.drafts.chat.set(draftIdentity, null, oversizedDraft());
    mounted.drafts.chat.set({ ...draftIdentity, workspaceSessionId: "session-2" }, null, {
      ...draftWithText("With a picked file"),
      attachments: [
        {
          id: "attachment-1",
          name: "photo.png",
          kind: "image",
          file: new File(["image"], "photo.png", { type: "image/png" }),
        },
      ],
    });
    await switchHost();

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["app unmounted", "host released", "navigated"]);
    expect(localStorage.getItem(toAgentChatDraftStorageKey(draftIdentity))).toBeNull();
    expect(currentTarget()).toEqual({ kind: "remote", endpoint: "https://host.test" });
  } finally {
    appSpy.mockRestore();
    consoleError.mockRestore();
  }
});

test("a pairing code pairs before the host switch, and a refused code keeps the page", async () => {
  const appSpy = spyOn(appModule, "App").mockImplementation(HostSwitchProbe);
  const navigate = mock(async () => {
    events.push("navigated");
  });
  const confirm = mock(async (_endpoint: string, code: string | undefined) => {
    events.push(`paired ${code}`);
    if (code === "111111") throw new Error("The pairing code is wrong, expired, or already used.");
  });
  try {
    await mountShell(navigate, undefined, confirm);
    const enterCode = async (code: string) => {
      fireEvent.change(await screen.findByLabelText("Host address"), {
        target: { value: "https://host.test" },
      });
      // The sixth digit submits the form.
      fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: code } });
      await waitFor(() => expect(confirm).toHaveBeenLastCalledWith("https://host.test", code));
    };
    await enterCode("111111");
    expect(await screen.findByText(/The pairing code is wrong/)).toBeDefined();
    expect(navigate).not.toHaveBeenCalled();
    expect(currentTarget()).toEqual({ kind: "local" });

    await enterCode("012345");
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenLastCalledWith("https://host.test", "012345");
    expect(events.filter((event) => event !== "app unmounted")).toEqual([
      "paired 111111",
      "paired 012345",
      "local host released",
      "navigated",
    ]);
  } finally {
    appSpy.mockRestore();
  }
});

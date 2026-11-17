import { connectionReconnectedEvent } from "@openducktor/frontend-core/recovery/connection-control-events";
import { ShortcutPreferencesProvider } from "./shortcut-preferences-provider";
import { expect, mock, test } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ShortcutPreferences } from "@openducktor/contracts";
import type { RunEventListener } from "@openducktor/frontend-core/connection/host-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { useShortcutPreferences } from "./use-shortcut-preferences";

test("one preference owner updates multiple consumers without input dispatch", async () => {
  let saved: ShortcutPreferences = { version: 1, overrides: {} };
  let receive!: RunEventListener;
  const stop = mock(() => {});
  const subscribe = mock(async (listener: RunEventListener) => {
    receive = listener;
    return stop;
  });
  const read = mock(async () => saved);
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      subscribeRunEvents: subscribe,
      client: { workspaceGetKeyboardShortcuts: read },
    }),
  });
  function Consumer({ name }: { name: string }) {
    const { query } = useShortcutPreferences();
    return (
      <output aria-label={name}>
        {query.data ? JSON.stringify(query.data.overrides) : "Loading"}
      </output>
    );
  }
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ShortcutPreferencesProvider>
        <Consumer name="First" />
        <Consumer name="Second" />
      </ShortcutPreferencesProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitFor(() => expect(screen.getByLabelText("First").textContent).toBe("{}"));
    expect(subscribe).toHaveBeenCalledTimes(1);
    saved = { version: 1, overrides: { sidebar: null } };
    await act(async () => {
      await receive({ type: "keyboard_shortcuts_saved" });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("First").textContent).toBe('{"sidebar":null}'),
    );
    expect(screen.getByLabelText("Second").textContent).toBe('{"sidebar":null}');
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      await receive(
        connectionReconnectedEvent(false, { hostChanged: false, missedEventNames: [] }),
      );
    });
    expect(read).toHaveBeenCalledTimes(2);
    saved = { version: 1, overrides: { palette: null } };
    await act(async () => {
      await receive(
        connectionReconnectedEvent(true, {
          hostChanged: false,
          missedEventNames: ["openducktor://run-event"],
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Second").textContent).toBe('{"palette":null}'),
    );
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    await connection.dispose();
  }
  expect(stop).toHaveBeenCalledTimes(1);
});

test("a subscription admitted after its preference owner leaves is released", async () => {
  const admitted = Promise.withResolvers<() => void>();
  const stop = mock(() => {});
  const connection = createTestClientConnection({
    host: createTestHostConnection({ subscribeRunEvents: () => admitted.promise }),
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ShortcutPreferencesProvider />
    </ClientConnectionProvider>,
  );
  view.unmount();
  await act(async () => {
    admitted.resolve(stop);
    await admitted.promise;
  });
  expect(stop).toHaveBeenCalledTimes(1);
  await connection.dispose();
});

test("an update-stream failure and saved data stay with their host connection", async () => {
  const failed = createTestClientConnection({
    host: createTestHostConnection({
      subscribeRunEvents: async () => {
        throw new Error("Update stream failed.");
      },
    }),
  });
  failed.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const healthy = createTestClientConnection();
  healthy.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: { sidebar: null },
  });
  function Consumer() {
    const { query, updatesError } = useShortcutPreferences();
    return <output>{updatesError ?? JSON.stringify(query.data?.overrides)}</output>;
  }
  const tree = (connection: typeof failed, key: string) => (
    <ClientConnectionProvider key={key} connection={connection}>
      <ShortcutPreferencesProvider>
        <Consumer />
      </ShortcutPreferencesProvider>
    </ClientConnectionProvider>
  );
  const view = render(tree(failed, "failed"));
  try {
    await screen.findByText(/Update stream failed/);
    view.rerender(tree(healthy, "healthy"));
    await screen.findByText('{"sidebar":null}');
    expect(screen.queryByText(/Update stream failed/)).toBeNull();
  } finally {
    view.unmount();
    await failed.dispose();
    await healthy.dispose();
  }
});

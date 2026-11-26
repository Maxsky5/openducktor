import "../test-support/dom-environment";
import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SystemWake } from "../platform/system-wake";
import { createAppVisibilityFake } from "../test-support/app-visibility-fake";
import { waitForExpectation } from "../test-support/wait-for-expectation";
import { useRefetchFailedRuntimeQueries } from "./use-refetch-failed-runtime-queries";

const todosKey = ["agent-session-todos", "/repo", "claude", "/repo", "session"];

const createSystemWakeFake = () => {
  const listeners = new Set<() => void>();
  const wake: SystemWake = {
    subscribe(onWake) {
      listeners.add(onWake);
      return () => listeners.delete(onWake);
    },
  };
  return { wake, fire: () => listeners.forEach((listener) => listener()), listeners };
};

/** Shows one runtime read that always fails, and counts its reads. */
const renderWithFailingRead = async (systemWake?: SystemWake) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const counter = { reads: 0 };
  const observer = new QueryObserver(client, {
    queryKey: todosKey,
    queryFn: async () => {
      counter.reads += 1;
      throw new Error("runtime unavailable");
    },
  });
  const stopObserver = observer.subscribe(() => {});
  await waitForExpectation(() => expect(client.getQueryState(todosKey)?.status).toBe("error"));
  const visibility = createAppVisibilityFake();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useRefetchFailedRuntimeQueries(visibility, systemWake), {
    wrapper,
  });
  const settle = () =>
    waitForExpectation(() => expect(client.getQueryState(todosKey)?.fetchStatus).toBe("idle"));
  return { client, counter, visibility, hook, settle, stopObserver };
};

afterEach(cleanup);

test("one return with a focus and a visibility change reads a failed read once", async () => {
  const { counter, visibility, settle, stopObserver } = await renderWithFailingRead();

  act(() => {
    visibility.setHidden(false);
    visibility.setHidden(false);
  });
  await settle();

  expect(counter.reads).toBe(2);
  stopObserver();
});

test("a change that hides the app does not read", async () => {
  const { counter, visibility, settle, stopObserver } = await renderWithFailingRead();

  act(() => visibility.setHidden(true));
  await settle();

  expect(counter.reads).toBe(1);
  stopObserver();
});

test("a system wake reads a failed read, and unmount stops listening", async () => {
  const systemWake = createSystemWakeFake();
  const { counter, hook, settle, stopObserver } = await renderWithFailingRead(systemWake.wake);

  act(() => systemWake.fire());
  await settle();
  hook.unmount();

  expect(counter.reads).toBe(2);
  expect(systemWake.listeners.size).toBe(0);
  stopObserver();
});

test("a return reads a failed read again while a slow read from the wake still runs", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const catalogKey = ["runtime-catalog", "catalog", "/repo", "claude", "/repo"];
  const catalogRead = Promise.withResolvers<string[]>();
  let todosReads = 0;
  let online = false;
  const stopObservers = [
    new QueryObserver(client, {
      queryKey: todosKey,
      queryFn: async () => {
        todosReads += 1;
        if (!online) throw new Error("offline");
        return ["todos"];
      },
    }).subscribe(() => {}),
  ];
  await waitForExpectation(() => expect(client.getQueryState(todosKey)?.status).toBe("error"));
  stopObservers.push(
    new QueryObserver(client, {
      queryKey: catalogKey,
      queryFn: () => catalogRead.promise,
    }).subscribe(() => {}),
  );
  const systemWake = createSystemWakeFake();
  const visibility = createAppVisibilityFake();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useRefetchFailedRuntimeQueries(visibility, systemWake.wake), { wrapper });

  // The wake reads todos again while the network is still down, and waits for the catalog.
  act(() => systemWake.fire());
  await waitForExpectation(() => expect(todosReads).toBe(2));
  await waitForExpectation(() => expect(client.getQueryState(todosKey)?.fetchStatus).toBe("idle"));
  online = true;
  act(() => visibility.setHidden(false));

  await waitForExpectation(() => expect(client.getQueryData(todosKey)).toEqual(["todos"]));
  expect(client.getQueryState(catalogKey)?.fetchStatus).toBe("fetching");
  catalogRead.resolve(["catalog"]);
  for (const stop of stopObservers) stop();
  client.clear();
});

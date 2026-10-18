import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { synchronizeConnectionState } from "./state-recovery";

test("host recovery refetches active host reads and skips reads marked to skip it", async () => {
  const queryClient = new QueryClient();
  const reads = { host: 0, device: 0 };
  const observe = (key: "host" | "device") =>
    new QueryObserver(queryClient, {
      queryKey: [key],
      queryFn: async () => ++reads[key],
      staleTime: Infinity,
      ...(key === "device" && { meta: { skipHostRecovery: true as const } }),
    }).subscribe(() => {});
  const stops = [observe("host"), observe("device")];
  try {
    await queryClient.refetchQueries();
    expect(reads).toEqual({ host: 1, device: 1 });

    await synchronizeConnectionState(queryClient, [], true);

    expect(reads).toEqual({ host: 2, device: 1 });
    expect(queryClient.getQueryState(["device"])?.isInvalidated).toBe(false);
  } finally {
    for (const stop of stops) stop();
    queryClient.clear();
  }
});

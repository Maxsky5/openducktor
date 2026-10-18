import { describe, expect, mock, test } from "bun:test";
import type { RepoPullRequestSyncResponse } from "@openducktor/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { toast, type ToastT } from "sonner";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import type { PullRequestSyncTarget } from "@/types/pull-request-sync";
import { useManualPullRequestSync } from "./use-manual-pull-request-sync";

describe("manual pull request sync", () => {
  test("keeps its chosen scope across rerenders and blocks duplicate calls until sync ends", async () => {
    const first = createDeferred<RepoPullRequestSyncResponse>();
    const syncHost = mock(
      async (path: string, _workspaceId?: string): Promise<RepoPullRequestSyncResponse> =>
        path === "/Alpha" ? first.promise : { ok: true },
    );
    const client = { repoPullRequestSync: syncHost };
    const harness = createHookHarness(() => useManualPullRequestSync(client), {});
    const scope = {
      kind: "all" as const,
      label: "captured scope",
      targets: [target("Alpha"), target("Beta")],
    };
    let running: Promise<void> | undefined;
    await harness.mount();
    try {
      await harness.run((operation) => {
        running = operation.sync(scope);
        void operation.sync({ kind: "all", label: "duplicate scope", targets: [target("Other")] });
      });
      expect(harness.getLatest().pendingScope).toEqual(scope);
      expect(latestToast("captured scope")).toMatchObject({ type: "loading", dismissible: false });
      scope.label = "changed scope";
      scope.targets[1]!.repoPath = "/changed";
      scope.targets[1]!.workspaceName = "Renamed";
      await harness.update({});
      await harness.run((operation) =>
        operation.sync({ kind: "all", label: "after navigation", targets: [target("Other")] }),
      );
      expect(syncHost).toHaveBeenCalledTimes(1);
      await harness.run(async () => {
        first.resolve({ ok: true });
        await running;
      });
      expect(syncHost.mock.calls).toEqual([
        ["/Alpha", "Alpha"],
        ["/Beta", "Beta"],
      ]);
      expect(harness.getLatest().pendingScope).toBeNull();
      const feedback = latestToast("captured scope");
      expect(feedback).toMatchObject({ type: "success" });
      expect(renderToStaticMarkup(<>{feedback.description}</>)).toContain("Beta: Sync completed.");
      await harness.run((operation) =>
        operation.sync({ kind: "all", label: "empty", targets: [] }),
      );
      expect(syncHost).toHaveBeenCalledTimes(2);
      await harness.run((operation) =>
        operation.sync({ kind: "workspace", label: "new run", targets: [target("Other")] }),
      );
      expect(syncHost).toHaveBeenLastCalledWith("/Other", "Other");
    } finally {
      first.resolve({ ok: true });
      try {
        await running;
      } finally {
        await harness.unmount();
        dismissSyncToast("captured scope");
        dismissSyncToast("new run");
      }
    }
  });

  test.each(["all skipped", "all failed", "partial failure", "partial skip"] as const)(
    "reports %s with workspace names and full recovery instructions, then releases pending state",
    async (scenario) => {
      const partial = scenario.startsWith("partial");
      const failed = scenario.endsWith("failed") || scenario.endsWith("failure");
      const recovery =
        "Task changes were saved, but their update event could not be sent. Reload the workspace before continuing. Do not repeat the change.";
      const skipMessage = "The workspace closed. Reopen it before syncing pull requests.";
      const syncHost = mock(
        async (path: string, _workspaceId?: string): Promise<RepoPullRequestSyncResponse> => {
          if (partial && path === "/Alpha") return { ok: true };
          if (failed) throw new Error(recovery);
          return { ok: false, reason: "workspace_closed", message: skipMessage };
        },
      );
      const client = { repoPullRequestSync: syncHost };
      const harness = createHookHarness(() => useManualPullRequestSync(client), {});
      const scope = `result ${scenario}`;
      await harness.mount();
      try {
        await harness.run((operation) =>
          operation.sync({ kind: "all", label: scope, targets: [target("Alpha"), target("Beta")] }),
        );
        expect(syncHost.mock.calls).toEqual([
          ["/Alpha", "Alpha"],
          ["/Beta", "Beta"],
        ]);
        expect(harness.getLatest().pendingScope).toBeNull();
        const feedback = latestToast(scope);
        expect(feedback).toMatchObject({
          type: failed ? "error" : "warning",
          duration: Infinity,
          closeButton: true,
        });
        const text = renderToStaticMarkup(<>{feedback.description}</>);
        expect(text).toContain("Beta:");
        expect(text).toContain(failed ? recovery : skipMessage);
        if (partial) {
          expect(feedback.title).toContain("partially completed");
          expect(text).toContain("Alpha: Sync completed.");
        } else {
          expect(text).toContain(
            scenario === "all failed"
              ? "No workspace was confirmed as synced."
              : "No workspace was synced.",
          );
        }
      } finally {
        await harness.unmount();
        dismissSyncToast(scope);
      }
    },
  );

  test.each([
    { kind: "all", reason: "not_configured", synced: true, feedback: "success" },
    { kind: "all", reason: "disabled", synced: true, feedback: "success" },
    { kind: "all", reason: "not_configured", synced: false, feedback: "info" },
    { kind: "all", reason: "disabled", synced: false, feedback: "info" },
    { kind: "workspace", reason: "not_configured", synced: false, feedback: "warning" },
    { kind: "workspace", reason: "disabled", synced: false, feedback: "warning" },
  ] as const)("reports $reason for $kind with synced=$synced as $feedback", async (scenario) => {
    const message = "Configure or enable a provider in Git provider settings.";
    const syncHost = mock(async (path: string): Promise<RepoPullRequestSyncResponse> =>
      path === "/Alpha" ? { ok: true } : { ok: false, reason: scenario.reason, message },
    );
    const client = { repoPullRequestSync: syncHost };
    const harness = createHookHarness(() => useManualPullRequestSync(client), {});
    const label = `${scenario.kind} ${scenario.reason} ${scenario.synced}`;
    await harness.mount();
    try {
      await harness.run((operation) =>
        operation.sync({
          kind: scenario.kind,
          label,
          targets: scenario.synced ? [target("Alpha"), target("Beta")] : [target("Beta")],
        }),
      );
      const feedback = latestToast(label);
      expect(feedback.type).toBe(scenario.feedback);
      expect(harness.getLatest().pendingScope).toBeNull();
      const text = renderToStaticMarkup(<>{feedback.description}</>);
      if (scenario.kind === "workspace") {
        expect(text).toContain("Beta:");
        expect(text).toContain(message);
      } else {
        expect(text).not.toContain("Beta:");
        expect(text).not.toContain(message);
        if (scenario.synced) {
          expect(feedback.title).toBe(`Pull request sync completed: ${label}`);
          expect(text).toContain("Alpha: Sync completed.");
        } else {
          expect(feedback.title).toBe(`No workspaces to sync: ${label}`);
          expect(text).toContain("No open workspace has an enabled Git provider.");
        }
      }
      expect(syncHost).toHaveBeenCalledTimes(scenario.synced ? 2 : 1);
    } finally {
      await harness.unmount();
      dismissSyncToast(label);
    }
  });
});

function target(name: string): PullRequestSyncTarget {
  return { workspaceId: name, workspaceName: name, repoPath: `/${name}` };
}

function latestToast(scope: string): ToastT {
  const found = findLatestToast(scope);
  if (!found) throw new Error("Sync feedback was not shown.");
  return found;
}

function dismissSyncToast(scope: string): void {
  const found = findLatestToast(scope);
  if (found) toast.dismiss(found.id);
}

function findLatestToast(scope: string): ToastT | undefined {
  const found = toast
    .getHistory()
    .findLast((item) => "title" in item && String(item.title).endsWith(scope));
  return found && "title" in found ? found : undefined;
}

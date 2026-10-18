import type { HostClient } from "@openducktor/host-client";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { PullRequestSyncScope, PullRequestSyncTarget } from "@/types/pull-request-sync";

export function useManualPullRequestSync(client: Pick<HostClient, "repoPullRequestSync">) {
  const [pendingScope, setPendingScope] = useState<PullRequestSyncScope | null>(null);
  // Block a second call before React commits the pending scope.
  const pendingRef = useRef(false);

  const sync = useCallback(
    async (scope: PullRequestSyncScope): Promise<void> => {
      if (pendingRef.current || scope.targets.length === 0) return;
      const captured = {
        kind: scope.kind,
        label: scope.label,
        targets: scope.targets.map(({ workspaceId, workspaceName, repoPath }) => ({
          workspaceId,
          workspaceName,
          repoPath,
        })),
      };
      pendingRef.current = true;
      setPendingScope(captured);
      const toastId = toast.loading(`Syncing pull requests: ${captured.label}`, {
        duration: Infinity,
        dismissible: false,
      });
      const results: WorkspaceResult[] = [];
      try {
        for (const target of captured.targets) {
          try {
            // Check each workspace at its turn; it may close while an earlier sync runs.
            // react-doctor-disable-next-line react-doctor/async-await-in-loop
            const result = await client.repoPullRequestSync(target.repoPath, target.workspaceId);
            if (
              captured.kind === "all" &&
              !result.ok &&
              (result.reason === "not_configured" || result.reason === "disabled")
            ) {
              continue;
            }
            results.push({
              target,
              status: result.ok ? "synced" : "skipped",
              message: result.ok ? "Sync completed." : result.message,
            });
          } catch (error) {
            // The host may save changes before the client loses its reply.
            results.push({ target, status: "unconfirmed", message: errorMessage(error) });
          }
        }
        if (results.length === 0) {
          toast.info(`No workspaces to sync: ${captured.label}`, {
            id: toastId,
            description:
              "No open workspace has an enabled Git provider. Configure one in Git provider settings to sync pull requests.",
            dismissible: true,
            closeButton: true,
            duration: 6000,
          });
          return;
        }
        const syncedCount = results.filter((result) => result.status === "synced").length;
        const unconfirmed = results.some((result) => result.status === "unconfirmed");
        let title = `Pull request sync partially completed: ${captured.label}`;
        if (syncedCount === results.length) {
          title = `Pull request sync completed: ${captured.label}`;
        } else if (syncedCount === 0) {
          title = unconfirmed
            ? `Pull request sync failed or is unconfirmed: ${captured.label}`
            : `Pull request sync skipped: ${captured.label}`;
        }
        const description = (
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap">
            {syncedCount === 0 ? (
              <p>
                {unconfirmed ? "No workspace was confirmed as synced." : "No workspace was synced."}
              </p>
            ) : null}
            {results.map(({ target, status, message }) => (
              <p key={target.workspaceId}>
                {target.workspaceName}: {status === "skipped" ? "Skipped. " : ""}
                {status === "unconfirmed"
                  ? "Sync failed or its result could not be confirmed. "
                  : ""}
                {message}
              </p>
            ))}
          </div>
        );
        const options = { id: toastId, description, dismissible: true, closeButton: true };
        if (unconfirmed) toast.error(title, { ...options, duration: Infinity });
        else if (syncedCount < results.length)
          toast.warning(title, { ...options, duration: Infinity });
        else toast.success(title, { ...options, duration: 6000 });
      } finally {
        pendingRef.current = false;
        setPendingScope(null);
      }
    },
    [client],
  );

  return { pendingScope, sync };
}

type WorkspaceResult = {
  target: PullRequestSyncTarget;
  status: "synced" | "skipped" | "unconfirmed";
  message: string;
};

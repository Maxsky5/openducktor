import type { RuntimeReadinessState } from "../lib/runtime-readiness";

/**
 * Why the Fork action of a completed reply cannot run now, or null when it can. Desktop and mobile
 * show the reason on the disabled action.
 */
export function sessionForkDisabledReason({
  runtimeReadiness,
  interactionEnabled,
  readOnly,
  readOnlyReason,
  error,
  waitsForMergePublication,
}: {
  runtimeReadiness: { state: RuntimeReadinessState; message: string | null };
  interactionEnabled: boolean;
  readOnly: boolean;
  readOnlyReason: string | null;
  error: string | null;
  /** True when the task of the session has a local direct merge that waits for its publication. */
  waitsForMergePublication: boolean;
}): string | null {
  if (runtimeReadiness.state !== "ready")
    return runtimeReadiness.message ?? "Start the runtime before forking this reply.";
  if (waitsForMergePublication) return "Publish or close the local merge before you fork a reply.";
  if (readOnly) return readOnlyReason ?? "Reopen this chat before forking a reply.";
  if (error) return error;
  return interactionEnabled ? null : "Load this chat before forking a reply.";
}

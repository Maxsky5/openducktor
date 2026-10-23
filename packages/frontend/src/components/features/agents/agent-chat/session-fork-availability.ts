import type { RuntimeReadinessState } from "@openducktor/frontend-core/lib/runtime-readiness";

export function sessionForkDisabledReason({
  runtimeReadiness,
  interactionEnabled,
  readOnly,
  readOnlyReason,
  error,
}: {
  runtimeReadiness: { state: RuntimeReadinessState; message: string | null };
  interactionEnabled: boolean;
  readOnly: boolean;
  readOnlyReason: string | null;
  error: string | null;
}): string | null {
  if (runtimeReadiness.state !== "ready")
    return runtimeReadiness.message ?? "Start the runtime before forking this reply.";
  if (readOnly) return readOnlyReason ?? "Reopen this chat before forking a reply.";
  if (error) return error;
  return interactionEnabled ? null : "Load this chat before forking a reply.";
}

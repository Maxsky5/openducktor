import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";

const TRANSCRIPT_IDENTITY_SEPARATOR = "\u0000";

type RuntimeTranscriptIdentityInput = {
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
};

export function getRuntimeTranscriptIdentityKey({
  externalSessionId,
  source,
}: RuntimeTranscriptIdentityInput): string | null {
  if (!externalSessionId) {
    return null;
  }

  return [externalSessionId, source?.runtimeKind ?? "", source?.workingDirectory ?? ""].join(
    TRANSCRIPT_IDENTITY_SEPARATOR,
  );
}

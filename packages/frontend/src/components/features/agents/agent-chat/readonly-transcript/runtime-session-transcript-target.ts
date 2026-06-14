import type { RuntimeKind } from "@openducktor/contracts";

export type RuntimeSessionTranscriptTarget = {
  externalSessionId: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
};

export type RuntimeSessionTranscriptIdentity = Pick<
  RuntimeSessionTranscriptTarget,
  "externalSessionId" | "runtimeKind" | "workingDirectory"
>;

const TRANSCRIPT_TARGET_KEY_SEPARATOR = "\u0000";

export const runtimeSessionTranscriptTargetKey = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: RuntimeSessionTranscriptIdentity): string =>
  [externalSessionId, runtimeKind, workingDirectory].join(TRANSCRIPT_TARGET_KEY_SEPARATOR);

export const matchesRuntimeSessionTranscriptTarget = (
  session: RuntimeSessionTranscriptIdentity | null | undefined,
  target: RuntimeSessionTranscriptTarget | null | undefined,
): session is RuntimeSessionTranscriptIdentity =>
  session !== null &&
  session !== undefined &&
  target !== null &&
  target !== undefined &&
  session.externalSessionId === target.externalSessionId &&
  session.runtimeKind === target.runtimeKind &&
  session.workingDirectory === target.workingDirectory;

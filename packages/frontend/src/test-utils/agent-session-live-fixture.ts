import type { AgentSessionLiveSnapshotEnvelope } from "@openducktor/contracts";

type LiveSnapshotInput = Pick<AgentSessionLiveSnapshotEnvelope, "sessions"> &
  Partial<Omit<AgentSessionLiveSnapshotEnvelope, "type" | "sessions">>;

/** A live snapshot of one repository. It has no message queue unless the test gives one. */
export const createLiveSnapshotEnvelope = ({
  repoPath = "/repo",
  messageQueues = [],
  ...rest
}: LiveSnapshotInput): AgentSessionLiveSnapshotEnvelope => ({
  type: "snapshot",
  repoPath,
  messageQueues,
  ...rest,
});

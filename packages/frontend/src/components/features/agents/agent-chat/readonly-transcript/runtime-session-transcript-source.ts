import type { RuntimeKind } from "@openducktor/contracts";

export type RuntimeSessionTranscriptSource = {
  runtimeKind: RuntimeKind;
  workingDirectory: string;
};

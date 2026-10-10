export { OpencodeSdkAdapter } from "./opencode-sdk-adapter";
export { OpenCodeMessageRejectedError } from "./opencode-message-rejected-error";
export { createPrepareOpencodeSessionRuntime } from "./opencode-session-runtime";
export type {
  OpencodeNativeApprovalReply,
  OpencodeNativeQuestionReply,
  OpencodeSessionRuntimeConnection,
  PreparedOpencodeSessionRuntime,
  PrepareOpencodeSessionRuntime,
  PrepareOpencodeSessionRuntimeInput,
} from "./opencode-session-runtime";
export type {
  OpencodeRuntimeSnapshotFailure,
  OpencodeRuntimeSnapshotRead,
  OpencodeRuntimeSnapshotSource,
} from "./live-session-snapshots";
export type {
  OpencodeSessionContextUsage,
  OpencodeSessionRuntimeSignal,
  OpencodeSessionTranscriptEvent,
} from "./opencode-session-runtime-signals";
export type {
  OpenCodeRuntimeConnection,
  OpencodeSdkAdapterOptions,
  ReadOpencodeDirectory,
  OpencodeEventLogger,
  OpencodeStreamEventLog,
} from "./types";
export { assertOpenCodeV2Connection, OpenCodeOperationError } from "./opencode-client";
import { createOpenCodeClient } from "./opencode-client";
import { readModelCatalog } from "./opencode-catalog";
import type { OpenCodeRuntimeConnection } from "./types";
export const loadOpencodeModelCatalogFromConnection = (
  directory: string,
  connection: OpenCodeRuntimeConnection,
) => readModelCatalog(createOpenCodeClient(connection), directory);

export { createOpenCodeRuntimeProbes } from "./opencode-runtime-probes";
export { bindOpenCodeWorkflowPlugin } from "./opencode-workflow-plugin";

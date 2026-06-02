import type { RegisteredCodexEventMapper } from "../codex-event-mapper";
import { emptyMapper } from "./empty";
import { compactionMapper, deltaMapper, lifecycleMapper, tokenUsageMapper } from "./lifecycle";
import { assistantMessageMapper, userMessageMapper } from "./messages";
import {
  collabToolMapper,
  commandToolMapper,
  dynamicToolMapper,
  fileChangeMapper,
  hiddenItemMapper,
  mcpToolMapper,
  planMapper,
  reasoningMapper,
  webSearchMapper,
} from "./stream-parts";
import { todoMapper } from "./todo";

export {
  /** @internal Test-only seam for compaction mapper parity coverage. */
  compactionMapper,
} from "./lifecycle";
export {
  type CodexTodoUpdate,
  codexTodosFromThreadRead,
  todoMapper,
} from "./todo";

export const CODEX_EVENT_MAPPERS = [
  compactionMapper,
  lifecycleMapper,
  tokenUsageMapper,
  deltaMapper,
  todoMapper,
  emptyMapper("question"),
  userMessageMapper,
  assistantMessageMapper,
  reasoningMapper,
  planMapper,
  commandToolMapper,
  fileChangeMapper,
  mcpToolMapper,
  webSearchMapper,
  collabToolMapper,
  dynamicToolMapper,
  hiddenItemMapper,
] satisfies RegisteredCodexEventMapper[];

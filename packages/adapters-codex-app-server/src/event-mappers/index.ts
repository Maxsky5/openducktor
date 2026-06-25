import type { RegisteredCodexEventMapper } from "../codex-event-mapper";
import { CodexSubagentLinkState } from "../codex-subagent-link-state";
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
import { createSubagentMapper } from "./subagents";
import { todoMapper } from "./todo";

export {
  type CodexTodoUpdate,
  codexTodosFromThreadRead,
  todoMapper,
} from "./todo";

export const createCodexEventMappers = (
  subagents: CodexSubagentLinkState = new CodexSubagentLinkState(),
): RegisteredCodexEventMapper[] => [
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
  createSubagentMapper(subagents),
  collabToolMapper,
  dynamicToolMapper,
  hiddenItemMapper,
];

export const CODEX_EVENT_MAPPERS = createCodexEventMappers();

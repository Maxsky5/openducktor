import type { RegisteredCodexEventMapper } from "../codex-event-mapper";
import { emptyMapper } from "./empty";
import { deltaMapper, lifecycleMapper, tokenUsageMapper } from "./lifecycle";
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

export { emptyMapper } from "./empty";
export { deltaMapper, lifecycleMapper, tokenUsageMapper } from "./lifecycle";
export { assistantMessageMapper, userMessageMapper } from "./messages";
export {
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
export {
  type CodexTodoUpdate,
  codexTodoItemsFromPayload,
  codexTodosFromThreadRead,
  codexTodoToolInputFromPayload,
  codexTodoUpdateFromPayload,
  codexTodoUpdateFromToolCall,
  todoMapper,
} from "./todo";

export const CODEX_EVENT_MAPPERS = [
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

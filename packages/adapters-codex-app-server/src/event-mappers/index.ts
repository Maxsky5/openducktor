import { registerCodexEventMapper, type RegisteredCodexEventMapper } from "../codex-event-mapper";
import type { CodexSubagentLinkState } from "../codex-subagent-link-state";
import { compactionMapper, deltaMapper, lifecycleMapper, tokenUsageMapper } from "./lifecycle";
import { assistantMessageMapper, userMessageMapper } from "./messages";
import {
  collabToolMapper,
  commandToolMapper,
  dynamicToolMapper,
  fileChangeMapper,
  mcpToolMapper,
  planMapper,
  reasoningMapper,
  webSearchMapper,
} from "./stream-parts";
import { createSubagentMapper } from "./subagents";
import { todoMapper } from "./todo";

export { type CodexTodoUpdate, codexTodosFromThreadRead, todoMapper } from "./todo";

export const createCodexEventMappers = (
  subagents: CodexSubagentLinkState,
): RegisteredCodexEventMapper[] =>
  [
    compactionMapper,
    lifecycleMapper,
    tokenUsageMapper,
    deltaMapper,
    todoMapper,
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
  ].map(registerCodexEventMapper);

import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  CLAUDE_RUNTIME_COMMAND_CONTRACTS_BY_COMMAND,
  type ClaudeRuntimeCommandName,
  type FileDiff,
  type FileStatus,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
} from "@openducktor/core";
import type { InvokeFn } from "./invoke-utils";

type ClaudeRuntimeCommandOutputMap = {
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels.command]: AgentModelCatalog;
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands.command]: AgentSlashCommandCatalog;
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills.command]: AgentSkillCatalog;
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents.command]: AgentSubagentCatalog;
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles.command]: AgentFileSearchResult[];
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory.command]: AgentSessionHistoryMessage[];
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos.command]: AgentSessionTodoItem[];
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff.command]: FileDiff[];
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus.command]: FileStatus[];
};

export const claudeRuntimeCommand = async <Command extends ClaudeRuntimeCommandName>(
  invokeFn: InvokeFn,
  command: Command,
  input: unknown,
): Promise<ClaudeRuntimeCommandOutputMap[Command]> => {
  const payload = await invokeFn(command, { input });
  const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS_BY_COMMAND[command];
  return contract.responseSchema.parse(payload) as ClaudeRuntimeCommandOutputMap[Command];
};

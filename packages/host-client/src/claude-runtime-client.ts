import { CLAUDE_RUNTIME_COMMAND_CONTRACTS } from "@openducktor/contracts";
import type {
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListAgentSubagentsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import type { InvokeFn } from "./invoke-utils";

export class HostClaudeRuntimeClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  claudeRuntimeListModels(input: ListAgentModelsInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeListSlashCommands(input: ListAgentSlashCommandsInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeListSkills(input: ListAgentSkillsInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeListSubagents(input: ListAgentSubagentsInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeSearchFiles(input: SearchAgentFilesInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeLoadSessionHistory(input: LoadAgentSessionHistoryInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeLoadSessionTodos(input: LoadAgentSessionTodosInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeLoadSessionDiff(input: LoadAgentSessionDiffInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  claudeRuntimeFileStatus(input: LoadAgentFileStatusInput) {
    const contract = CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }
}

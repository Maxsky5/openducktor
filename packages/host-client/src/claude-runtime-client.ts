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
import { claudeRuntimeCommand } from "./claude-runtime-response-parsers";
import type { InvokeFn } from "./invoke-utils";

export class HostClaudeRuntimeClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  claudeRuntimeListModels(input: ListAgentModelsInput) {
    return claudeRuntimeCommand(this.invokeFn, CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels, input);
  }

  claudeRuntimeListSlashCommands(input: ListAgentSlashCommandsInput) {
    return claudeRuntimeCommand(
      this.invokeFn,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands,
      input,
    );
  }

  claudeRuntimeListSkills(input: ListAgentSkillsInput) {
    return claudeRuntimeCommand(this.invokeFn, CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills, input);
  }

  claudeRuntimeListSubagents(input: ListAgentSubagentsInput) {
    return claudeRuntimeCommand(
      this.invokeFn,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents,
      input,
    );
  }

  claudeRuntimeSearchFiles(input: SearchAgentFilesInput) {
    return claudeRuntimeCommand(this.invokeFn, CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles, input);
  }

  claudeRuntimeLoadSessionHistory(input: LoadAgentSessionHistoryInput) {
    return claudeRuntimeCommand(
      this.invokeFn,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory,
      input,
    );
  }

  claudeRuntimeLoadSessionTodos(input: LoadAgentSessionTodosInput) {
    return claudeRuntimeCommand(
      this.invokeFn,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos,
      input,
    );
  }

  claudeRuntimeLoadSessionDiff(input: LoadAgentSessionDiffInput) {
    return claudeRuntimeCommand(
      this.invokeFn,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff,
      input,
    );
  }

  claudeRuntimeFileStatus(input: LoadAgentFileStatusInput) {
    return claudeRuntimeCommand(this.invokeFn, CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus, input);
  }
}

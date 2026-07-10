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
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_list_models", input);
  }

  claudeRuntimeListSlashCommands(input: ListAgentSlashCommandsInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_list_slash_commands", input);
  }

  claudeRuntimeListSkills(input: ListAgentSkillsInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_list_skills", input);
  }

  claudeRuntimeListSubagents(input: ListAgentSubagentsInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_list_subagents", input);
  }

  claudeRuntimeSearchFiles(input: SearchAgentFilesInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_search_files", input);
  }

  claudeRuntimeLoadSessionHistory(input: LoadAgentSessionHistoryInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_load_session_history", input);
  }

  claudeRuntimeLoadSessionTodos(input: LoadAgentSessionTodosInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_load_session_todos", input);
  }

  claudeRuntimeLoadSessionDiff(input: LoadAgentSessionDiffInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_load_session_diff", input);
  }

  claudeRuntimeFileStatus(input: LoadAgentFileStatusInput) {
    return claudeRuntimeCommand(this.invokeFn, "claude_runtime_file_status", input);
  }
}

import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY, type AgentEvent } from "@openducktor/core";
import {
  normalizePathForComparison,
  pathStartsWith,
  resolveAgainstWorkingDirectory,
  toProjectRelativePath,
} from "@openducktor/path-support";
import {
  claudeSubagentPendingInputRoute,
  emitClaudePendingInputEvent,
} from "./claude-agent-sdk-pending-input-routing";
import {
  isClaudeAskUserQuestionTool,
  requestClaudeAskUserQuestion,
} from "./claude-agent-sdk-questions";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";
import {
  canonicalOdtToolName,
  claudeWorkflowRole,
  isReadOnlyWorkflowRole,
  mutationForTool,
  permissionRequestTypeForTool,
  readStringProp,
} from "./claude-agent-sdk-utils";

type CreateClaudeCanUseToolInput = {
  session: ClaudeSessionContext;
  now: () => string;
  randomId: () => string;
  emit: (session: ClaudeSessionContext, event: AgentEvent) => void;
  canonicalizePath?: (path: string) => Promise<string>;
};

const withAllowedToolInput = (
  result: PermissionResult,
  toolInput: Record<string, unknown>,
): PermissionResult =>
  result.behavior === "allow"
    ? {
        ...result,
        updatedInput: result.updatedInput ?? toolInput,
      }
    : result;

const denyReadOnlyPolicy = (message: string): PermissionResult => ({
  behavior: "deny",
  decisionClassification: "user_reject",
  message,
});

const SESSION_PATH_INPUT_KEYS = [
  "file_path",
  "path",
  "repo",
  "notebook_path",
  "target_file",
] as const;

const rewriteSessionPath = (session: ClaudeSessionContext, value: string): string => {
  const { repoPath, workingDirectory } = session.input;
  if (normalizePathForComparison(repoPath) === normalizePathForComparison(workingDirectory)) {
    return value;
  }
  if (normalizePathForComparison(value) === normalizePathForComparison(repoPath)) {
    return workingDirectory;
  }
  if (pathStartsWith(value, repoPath)) {
    return resolveAgainstWorkingDirectory(workingDirectory, toProjectRelativePath(value, repoPath));
  }
  return value;
};

const normalizeToolInputForSession = (
  session: ClaudeSessionContext,
  _toolName: string,
  toolInput: Record<string, unknown>,
): Record<string, unknown> => {
  const nextInput = { ...toolInput };
  let changed = false;

  for (const key of SESSION_PATH_INPUT_KEYS) {
    const value = nextInput[key];
    if (typeof value !== "string") {
      continue;
    }
    const rewritten = rewriteSessionPath(session, value);
    if (rewritten !== value) {
      nextInput[key] = rewritten;
      changed = true;
    }
  }

  return changed ? nextInput : toolInput;
};

const readOnlyToolPathValues = (
  session: ClaudeSessionContext,
  toolInput: Record<string, unknown>,
  blockedPath: string | undefined,
): string[] => {
  const paths: string[] = [];
  if (blockedPath) {
    paths.push(rewriteSessionPath(session, blockedPath));
  }

  for (const key of SESSION_PATH_INPUT_KEYS) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim().length > 0) {
      paths.push(value);
    }
  }

  return paths;
};

const isInsideCanonicalWorkingDirectory = (
  canonicalWorkingDirectory: string,
  canonicalCandidate: string,
): boolean => {
  const relativePath = relative(canonicalWorkingDirectory, canonicalCandidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const canonicalReadPathViolation = async (
  session: ClaudeSessionContext,
  rawPath: string,
  canonicalizePath: (path: string) => Promise<string>,
): Promise<string | null> => {
  const candidate = rawPath.trim();
  if (!candidate || candidate.startsWith("~")) {
    return rawPath;
  }
  const resolvedPath = resolveAgainstWorkingDirectory(session.input.workingDirectory, candidate);
  try {
    const [canonicalWorkingDirectory, canonicalCandidate] = await Promise.all([
      canonicalizePath(session.input.workingDirectory),
      canonicalizePath(resolvedPath),
    ]);
    return isInsideCanonicalWorkingDirectory(canonicalWorkingDirectory, canonicalCandidate)
      ? null
      : rawPath;
  } catch {
    return `${rawPath} (path could not be resolved canonically)`;
  }
};

const findReadOnlyPathPolicyViolation = async (
  session: ClaudeSessionContext,
  toolInput: Record<string, unknown>,
  blockedPath: string | undefined,
  canonicalizePath: (path: string) => Promise<string>,
): Promise<string | null> => {
  const paths = readOnlyToolPathValues(session, toolInput, blockedPath);
  for (const path of paths) {
    const violation = await canonicalReadPathViolation(session, path, canonicalizePath);
    if (violation) {
      return violation;
    }
  }
  return null;
};

export const createClaudeCanUseTool = (input: CreateClaudeCanUseToolInput): CanUseTool => {
  const { canonicalizePath = realpath, emit, now, randomId, session } = input;
  return async (toolName, toolInput, options) => {
    const effectiveToolInput = normalizeToolInputForSession(session, toolName, toolInput);
    const role = claudeWorkflowRole(session.input);
    if (isClaudeAskUserQuestionTool(toolName)) {
      if (options.signal.aborted) {
        return {
          behavior: "deny",
          message: "Claude question request was aborted.",
          interrupt: true,
        };
      }
      const result = await requestClaudeAskUserQuestion({
        emit,
        now,
        randomId,
        session,
        signal: options.signal,
        toolInput: effectiveToolInput,
        toolUseID: options.toolUseID,
        agentID: options.agentID,
      });
      if (!result) {
        return {
          behavior: "deny",
          message: "Claude question request was aborted.",
          interrupt: true,
        };
      }
      return withAllowedToolInput(
        {
          behavior: "allow",
          updatedInput: {
            ...effectiveToolInput,
            answers: result.answers,
          },
        },
        effectiveToolInput,
      );
    }

    const odtToolName = canonicalOdtToolName(toolName);
    if (odtToolName && role) {
      if (!(AGENT_ROLE_TOOL_POLICY[role] as readonly string[]).includes(odtToolName)) {
        return denyReadOnlyPolicy(`Tool ${odtToolName} is not allowed for ${role} sessions.`);
      }
      return withAllowedToolInput({ behavior: "allow" }, effectiveToolInput);
    }
    const mutation = mutationForTool(toolName, effectiveToolInput);
    if (isReadOnlyWorkflowRole(role)) {
      if (
        CLAUDE_RUNTIME_DESCRIPTOR.readOnlyRoleBlockedTools.some(
          (blockedTool) => blockedTool.toLowerCase() === toolName.toLowerCase(),
        )
      ) {
        return denyReadOnlyPolicy(
          `Tool ${toolName} is disabled for read-only OpenDucktor workflow roles.`,
        );
      }
      if (mutation !== "read_only") {
        return denyReadOnlyPolicy(
          `Tool ${toolName} is not classified as read-only for OpenDucktor ${role} sessions.`,
        );
      }
      const pathViolation = await findReadOnlyPathPolicyViolation(
        session,
        effectiveToolInput,
        options.blockedPath,
        canonicalizePath,
      );
      if (pathViolation) {
        return denyReadOnlyPolicy(
          `Tool ${toolName} attempted to read outside the session working directory: ${pathViolation}`,
        );
      }
      return withAllowedToolInput({ behavior: "allow" }, effectiveToolInput);
    }

    if (mutation === "read_only") {
      const pathViolation = await findReadOnlyPathPolicyViolation(
        session,
        effectiveToolInput,
        options.blockedPath,
        canonicalizePath,
      );
      if (!pathViolation) {
        return withAllowedToolInput({ behavior: "allow" }, effectiveToolInput);
      }
    }

    if (options.signal.aborted) {
      return {
        behavior: "deny",
        message: "Claude permission request was aborted.",
        interrupt: true,
      };
    }

    const requestId = randomId();
    const command = readStringProp(effectiveToolInput, "command");
    const blockedPath = options.blockedPath
      ? rewriteSessionPath(session, options.blockedPath)
      : undefined;
    const event: Extract<AgentEvent, { type: "approval_required" }> = {
      type: "approval_required",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      requestId,
      requestType: permissionRequestTypeForTool(toolName),
      title: options.title ?? options.displayName ?? `Approve ${toolName}`,
      ...(options.description ? { summary: options.description } : {}),
      ...(options.decisionReason ? { details: options.decisionReason } : {}),
      ...(blockedPath ? { affectedPaths: [blockedPath] } : {}),
      ...(command
        ? {
            command: {
              command,
              workingDirectory: session.input.workingDirectory,
            },
          }
        : {}),
      tool: {
        name: toolName,
        ...(options.displayName ? { title: options.displayName } : {}),
        input: effectiveToolInput,
      },
      mutation,
      supportedReplyOutcomes: ["approve_once", "reject"],
      metadata: {
        runtime: "claude",
        ...(options.agentID ? { agentId: options.agentID } : {}),
      },
      ...claudeSubagentPendingInputRoute(session.externalSessionId, options.agentID),
    };
    return new Promise<PermissionResult>((resolveResult) => {
      const onAbort = () => {
        session.pendingApprovals.delete(requestId);
        resolveResult({
          behavior: "deny",
          message: "Claude permission request was aborted.",
          interrupt: true,
        });
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      session.pendingApprovals.set(requestId, {
        event,
        resolve: (result) => {
          options.signal.removeEventListener("abort", onAbort);
          resolveResult(withAllowedToolInput(result, effectiveToolInput));
        },
      });
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      emitClaudePendingInputEvent({ emit, event, session });
    });
  };
};

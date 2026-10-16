import type {
  AgentMessageTarget,
  AgentSessionModelSelection,
  RepoPromptOverrides,
  AgentModelCatalog,
  AgentSessionControlSendInput,
} from "@openducktor/contracts";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import {
  buildAgentSystemPrompt,
  mergePromptOverrides,
  resolveSavedSessionModel,
  isSameSelection,
  resolveModelSelectionPolicy,
  findCatalogModel,
  readAttachmentValidationError,
} from "@openducktor/core";
import { Effect } from "effect";
import {
  HostValidationError,
  toHostOperationError,
  type HostError,
} from "../../effect/host-errors";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";

type PreparationTarget = Omit<AgentMessageTarget, "externalSessionId">;

export const createSessionTurnPreparation = (deps: {
  settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath" | "getSettingsSnapshot">;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog" | "loadSessionHistory">;
  taskReader: Pick<TaskStorePort, "getTask">;
}) => {
  const catalogFor = (target: PreparationTarget) =>
    Effect.gen(function* () {
      const read = yield* deps.queries.loadRuntimeCatalog(target);
      if (read.models?.status !== "available")
        return yield* new HostValidationError({
          field: "model",
          message: `The selected runtime model catalog is unavailable: ${read.models?.status === "failed" ? read.models.message : "no catalog was returned"}. Refresh the catalog before sending.`,
        });
      return read.models.catalog;
    });
  const validateAttachments = (
    parts: Readonly<AgentSessionControlSendInput["parts"]>,
    catalog: AgentModelCatalog,
    selected: Pick<AgentSessionModelSelection, "providerId" | "modelId"> | null,
    modelLabel = "The selected model",
  ) =>
    Effect.gen(function* () {
      const model = selected ? findCatalogModel(catalog, selected) : null;
      for (const part of parts) {
        if (part.kind !== "attachment") continue;
        if (!catalog.runtime?.capabilities.promptInput.supportsAttachments)
          return yield* new HostValidationError({
            field: "parts",
            message:
              "The selected runtime does not expose attachment support. Remove the attachments before sending.",
          });
        const error = readAttachmentValidationError(
          part.attachment,
          model?.attachmentSupport,
          modelLabel,
        );
        if (error)
          return yield* new HostValidationError({
            field: "parts",
            message: `${part.attachment.name}: ${error}`,
          });
      }
    });
  const settingsFor = (target: PreparationTarget) =>
    Effect.gen(function* () {
      const config = yield* deps.settings.getRepoConfigByRepoPath(target.repoPath);
      const settings = yield* deps.settings.getSettingsSnapshot();
      return mergePromptOverrides({
        globalOverrides: settings.globalPromptOverrides,
        repoOverrides: config.promptOverrides,
      });
    });
  return {
    steeringContent: (
      target: AgentMessageTarget,
      parts: Readonly<AgentSessionControlSendInput["parts"]>,
    ): Effect.Effect<void, HostError> =>
      Effect.gen(function* () {
        if (!parts.some((part) => part.kind === "attachment")) return;
        const catalog = yield* catalogFor(target);
        const request =
          target.runtimeKind === "codex"
            ? {
                ...target,
                runtimeKind: "codex" as const,
                runtimePolicy: {
                  kind: "codex" as const,
                  policy: resolveCodexEffectivePolicy(
                    (yield* deps.settings.getSettingsSnapshot()).agentRuntimes.codex,
                    target.sessionScope.kind === "workflow" ? target.sessionScope.role : null,
                  ),
                },
              }
            : target.runtimeKind === "claude"
              ? {
                  ...target,
                  runtimeKind: "claude" as const,
                  runtimePolicy: { kind: "claude" as const },
                }
              : {
                  ...target,
                  runtimeKind: "opencode" as const,
                  runtimePolicy: { kind: "opencode" as const },
                };
        const history = yield* deps.queries.loadSessionHistory(request);
        let turnModel: AgentSessionControlSendInput["model"] = undefined;
        for (const message of history.toReversed()) {
          if (message.role === "system") continue;
          if (message.model) {
            turnModel = message.model;
            break;
          }
          // Do not use model evidence from a previous turn.
          if (message.role === "user") break;
        }
        if (!turnModel)
          return yield* new HostValidationError({
            field: "parts",
            message:
              "The model of the running turn is unknown. Queue the message until its attachment support can be checked.",
          });
        yield* validateAttachments(parts, catalog, turnModel, "The model of the running turn");
      }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-steering"))),
    promptOverrides: (
      target: AgentMessageTarget,
    ): Effect.Effect<RepoPromptOverrides, import("../../effect/host-errors").HostError> =>
      settingsFor(target).pipe(
        Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-context")),
      ),
    context: (target: PreparationTarget) =>
      Effect.gen(function* () {
        if (target.sessionScope.kind === "repository") return undefined;
        const overrides = yield* settingsFor(target);
        const task = yield* deps.taskReader.getTask({
          repoPath: target.repoPath,
          taskId: target.sessionScope.taskId,
        });
        return buildAgentSystemPrompt({
          role: target.sessionScope.role,
          task: {
            taskId: task.id,
            title: task.title,
            issueType: task.issueType,
            status: task.status,
            qaRequired: task.aiReviewEnabled,
            description: task.description,
          },
          overrides,
        });
      }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-context"))),
    model: (
      target: PreparationTarget,
      saved: AgentSessionModelSelection | null,
      {
        captured = false,
        previous,
        parts = [],
      }: {
        captured?: boolean;
        previous?: AgentSessionModelSelection | null;
        parts?: Readonly<AgentSessionControlSendInput["parts"]>;
      } = {},
    ) =>
      Effect.gen(function* () {
        if (saved?.runtimeKind && saved.runtimeKind !== target.runtimeKind)
          return yield* new HostValidationError({
            field: "model",
            message:
              "The selected model belongs to another runtime. Select a model for this session's runtime.",
          });
        const config = yield* deps.settings.getRepoConfigByRepoPath(target.repoPath);
        const catalog = yield* catalogFor(target);
        const decision = resolveSavedSessionModel({
          runtimeKind: target.runtimeKind,
          savedSelection: saved,
          defaultSelection:
            target.sessionScope.kind === "workflow"
              ? (config.agentDefaults[target.sessionScope.role] ?? config.defaultModel ?? null)
              : (config.defaultModel ?? null),
          catalog,
        });
        if (decision.kind === "blocked")
          return yield* new HostValidationError({
            field: decision.reason,
            message: decision.message,
          });
        if (captured && (decision.kind === "repair" || !isSameSelection(saved, decision.selection)))
          return yield* new HostValidationError({
            field: "model",
            message:
              "The model captured for this message is no longer permitted. Review the queued message and select a permitted model before sending a new message.",
          });
        if (previous !== undefined && saved) {
          const model = findCatalogModel(catalog, saved);
          const policy = resolveModelSelectionPolicy(model, true);
          if (!policy.canChangeProfile && saved.profileId !== previous?.profileId)
            return yield* new HostValidationError({
              field: "profile",
              message:
                "This runtime cannot change the profile of a live session. Start a new session with the required profile.",
            });
          if (
            saved.variant !== previous?.variant &&
            saved.variant &&
            !policy.variants.includes(saved.variant)
          )
            return yield* new HostValidationError({
              field: "model",
              message:
                "This runtime cannot apply this variant to a live session. Select a permitted variant or start a new session.",
            });
        }
        yield* validateAttachments(parts, catalog, decision.selection);
        return decision;
      }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "session.prepare-model"))),
  };
};

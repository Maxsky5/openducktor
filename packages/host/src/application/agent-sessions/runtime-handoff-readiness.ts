import type {
  AgentMessageTarget,
  AgentModelCatalog,
  AgentModelDescriptor,
  AgentChatHandoffSendInput,
  AgentSessionLiveRef,
  AgentSessionUserMessagePart,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { readAttachmentValidationError, resolveSavedSessionModel } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError, type HostError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import { hasBlockingInput, hasForegroundTurn } from "./session-foreground-readiness";

const invalid = (message: string) => new HostValidationError({ field: "handoff", message });

export const prepareHandoffModel = (
  catalog: AgentModelCatalog,
  model: AgentChatHandoffSendInput["destination"],
) => {
  const decision = resolveSavedSessionModel({
    catalog,
    runtimeKind: model.runtimeKind,
    savedSelection: model,
    defaultSelection: null,
  });
  if (decision.kind === "blocked") return Effect.fail(invalid(decision.message));
  if (!decision.selection)
    return Effect.fail(invalid("Refresh the destination catalog and select a model."));
  return Effect.succeed({ ...decision.selection, runtimeKind: model.runtimeKind });
};

export const unsupportedHandoffParts = (
  parts: AgentSessionUserMessagePart[],
  promptInput: RuntimeDescriptor["capabilities"]["promptInput"],
  model: AgentModelDescriptor,
) =>
  parts.flatMap((part, index) => {
    if (part.kind === "slash_command")
      return [{ index, reason: "Send runtime commands in their original runtime." }];
    if (part.kind === "attachment") {
      const reason = promptInput.supportsAttachments
        ? readAttachmentValidationError(part.attachment, model.attachmentSupport, model.modelName)
        : "The destination runtime cannot send attachments.";
      return reason ? [{ index, reason }] : [];
    }
    const kind =
      part.kind === "file_reference" && part.file.kind === "directory"
        ? "folder_reference"
        : part.kind;
    return promptInput.supportedParts.includes(kind)
      ? []
      : [
          {
            index,
            reason: `The destination runtime cannot send this ${kind.replaceAll("_", " ")}.`,
          },
        ];
  });

export const requireHandoffSourceReady = (
  source: AgentMessageTarget,
  runtime: Pick<AgentSessionLiveStateService, "read" | "list">,
  ensureNoScheduledWork: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>,
) =>
  Effect.gen(function* () {
    const live = yield* runtime.read(source);
    if (live.type !== "live" || live.session.statusUnavailableReason)
      return yield* invalid(
        "Reopen the source session to confirm its runtime status before switching.",
      );
    const snapshots = yield* runtime.list({ repoPath: source.repoPath });
    const memberIds = new Set([source.externalSessionId]);
    const descendants = [live.session];
    for (let index = 0; index < descendants.length; index++) {
      const parent = descendants[index];
      for (const child of snapshots) {
        if (
          child.ref.runtimeKind !== source.runtimeKind ||
          child.parentExternalSessionId !== parent?.ref.externalSessionId ||
          memberIds.has(child.ref.externalSessionId)
        )
          continue;
        memberIds.add(child.ref.externalSessionId);
        descendants.push(child);
      }
    }
    if (descendants.some((session) => hasBlockingInput(session)))
      return yield* invalid("Resolve the source's questions and approvals before switching.");
    if (descendants.some((session) => hasForegroundTurn(session) || session.activity !== "idle"))
      return yield* invalid(
        "Wait for the source and its child agents to finish, or stop their work.",
      );
    if (
      descendants.some(({ goal }) => goal && goal.status !== "ended" && goal.status !== "complete")
    )
      return yield* invalid("End the source's goal before switching.");
    yield* Effect.forEach(descendants, ({ ref }) => ensureNoScheduledWork(ref), {
      discard: true,
    });
  });

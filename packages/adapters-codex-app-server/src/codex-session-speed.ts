import type { AgentSessionSpeedState, AgentSpeedAvailability } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { initialSpeedState } from "@openducktor/core";
import type {
  CodexAppServerClient,
  CodexAppServerAdapterOptions,
  CodexSessionState,
} from "./types";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexModels } from "./model-catalog";
import { codexSessionRef } from "./codex-session-ref";

export class CodexSessionSpeedControl {
  constructor(
    private readonly context: {
      runtimeClients: CodexRuntimeClientResolver;
      models: CodexModels;
      recordSpeedChoice: CodexAppServerAdapterOptions["recordSpeedChoice"];
      isCurrent: (session: CodexSessionState) => boolean;
    },
  ) {}

  get availability(): AgentSpeedAvailability {
    return { status: "available" };
  }

  async reportedChoice(session: CodexSessionState, tier: string | null): Promise<string | null> {
    if (codexServiceTier(tier) === null) return "standard";
    const models = await this.context.models.list(
      this.context.runtimeClients.clientForRuntime(session.runtimeId),
      session.runtimeId,
    );
    const model = models.data.find(
      (entry) => entry.model === session.model?.modelId || entry.id === session.model?.modelId,
    );
    const selectedTier = model?.serviceTiers.find((entry) => entry.id === tier);
    return selectedTier?.id ?? null;
  }

  assertTierAccepted(requested: string | null | undefined, reported: string | null): void {
    if (requested !== undefined && codexServiceTier(requested) !== codexServiceTier(reported))
      throw new Error(
        "Codex did not accept the requested speed setting. Set speed explicitly before starting work.",
      );
  }

  async observe(
    session: CodexSessionState,
    tier: string | null,
    model: AgentModelSelection,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (!isCurrent() || session.turnAdmission.isHeld) return;
    const release = await session.turnAdmission.hold();
    try {
      await this.applyReport(session, tier, model, isCurrent);
    } finally {
      release();
    }
  }

  /** The caller owns turn admission while it applies a held native report. */
  async applyReport(
    session: CodexSessionState,
    tier: string | null,
    model: AgentModelSelection,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (!isCurrent()) return;
    tier = codexServiceTier(tier);
    const admission = session.turnAdmission;
    if (!admission.isHeld)
      throw new Error("Hold turn admission before applying a settings report.");
    let committed = false;
    const previous = session.summary.speed;
    const previousTier = session.serviceTier;
    const previousModel = session.model;
    session.model = { ...session.model, ...model };
    const modelChanged =
      previousModel?.modelId !== model.modelId ||
      previousModel.providerId !== model.providerId ||
      previousModel.variant !== model.variant;
    try {
      let choice = await this.reportedChoice(session, tier);
      if (!isCurrent()) return;
      if (previous?.choice != null && previous.choice !== "standard" && modelChanged) {
        const catalog = await this.context.models.list(
          this.context.runtimeClients.clientForRuntime(session.runtimeId),
          session.runtimeId,
        );
        const target = catalog.data.find(
          (entry) => entry.model === model.modelId || entry.id === model.modelId,
        );
        if (!isCurrent()) return;
        if (target && !target.serviceTiers.some((entry) => entry.id === previous?.choice)) {
          await this.applyTier(session, null);
          if (!isCurrent()) return;
          tier = null;
          choice = "standard";
        }
      }
      const speed: AgentSessionSpeedState =
        choice === null
          ? {
              ...initialSpeedState(modelChanged ? null : (previous?.choice ?? null), "uncertain"),
              reason: {
                code: "unknown_service_tier",
                message: `Codex reported an unknown service tier '${tier}'.`,
                nextAction: "Set speed explicitly before sending another message.",
              },
            }
          : initialSpeedState(choice, "confirmed");
      if (choice === null && !modelChanged) {
        session.summary.speed = speed;
        admission.setBlocked(true);
        return;
      }
      if (choice !== previous?.choice || modelChanged) {
        if (!this.context.recordSpeedChoice)
          throw new Error("Speed persistence is not configured.");
        const publish = await this.context.recordSpeedChoice(
          codexSessionRef(session),
          choice,
          isCurrent,
          modelChanged ? session.model : undefined,
          previous?.choice === null ? null : undefined,
        );
        if (!isCurrent()) return;
        session.serviceTier = tier;
        session.summary.speed = speed;
        admission.setBlocked(choice === null);
        committed = true;
        await publish();
      } else {
        session.serviceTier = tier;
        session.summary.speed = speed;
      }
      admission.setBlocked(choice === null);
    } catch (cause) {
      if (!isCurrent()) return;
      if (committed) throw cause;
      if (
        !modelChanged &&
        previous?.choice !== null &&
        previous?.choice !== undefined &&
        previous.synchronization === "confirmed"
      ) {
        try {
          await this.applyTier(session, previousTier ?? null);
        } catch (restoreFailure) {
          session.summary.speed = {
            ...previous,
            synchronization: "uncertain",
            reason: {
              code: "settings_uncertain",
              message:
                "Could not save or restore speed. Set it explicitly before sending another message.",
            },
          };
          admission.setBlocked(true);
          throw new Error("Native speed save and restore failed.", {
            cause: { cause, restoreFailure },
          });
        }
        session.serviceTier = previousTier ?? null;
        session.summary.speed = previous;
        admission.setBlocked(false);
        throw cause;
      }
      session.summary.speed = {
        ...initialSpeedState(previous?.choice ?? null, "uncertain"),
        reason: {
          code: "settings_uncertain",
          message:
            "Could not confirm the native speed change. Set speed explicitly before sending another message.",
        },
      };
      admission.setBlocked(true);
      throw cause;
    }
  }

  async prepareTurn(session: CodexSessionState, model: AgentModelSelection): Promise<void> {
    const isCurrent = () => this.context.isCurrent(session);
    const previous = session.summary.speed;
    if (!previous || previous.choice === "standard") return;
    if (previous.choice === null || previous.synchronization !== "confirmed")
      throw new Error("Set speed explicitly before sending another message.");
    const client = this.context.runtimeClients.clientForRuntime(session.runtimeId);
    const models = await this.context.models.list(client, session.runtimeId);
    if (!isCurrent()) throw new Error("This session was released before its turn could start.");
    const target = models.data.find(
      (entry) => entry.model === model.modelId || entry.id === model.modelId,
    );
    if (!target)
      throw new Error(
        "The selected model is absent from the Codex catalog. Refresh the model list or select Standard.",
      );
    const tier = target.serviceTiers.find((entry) => entry.id === previous.choice);
    if (tier) {
      session.serviceTier = tier.id;
      return;
    }
    if (!this.context.recordSpeedChoice) throw new Error("Speed persistence is not configured.");
    let publish: () => Promise<void>;
    try {
      await this.applyTier(session, null);
      publish = await this.context.recordSpeedChoice(
        codexSessionRef(session),
        "standard",
        isCurrent,
      );
    } catch (cause) {
      if (!isCurrent()) throw cause;
      try {
        await this.applyTier(session, session.serviceTier ?? null);
      } catch (restoreFailure) {
        session.summary.speed = {
          ...previous,
          synchronization: "uncertain",
          reason: {
            code: "settings_uncertain",
            message:
              "Speed reset and restore failed. Set speed explicitly before sending another message.",
          },
        };
        session.turnAdmission.setBlocked(true);
        throw new Error("Speed reset and restore failed.", {
          cause: { cause, restoreFailure },
        });
      }
      throw cause;
    }
    session.serviceTier = null;
    session.summary.speed = initialSpeedState("standard", "confirmed");
    await publish();
  }

  async applyTier(session: CodexSessionState, tier: string | null): Promise<void> {
    session.settingsRevision = (session.settingsRevision ?? 0) + 1;
    const report = new Promise<void>((acknowledge) => {
      session.pendingSpeedReport = { serviceTier: tier, acknowledge };
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.context.runtimeClients
        .clientForRuntime(session.runtimeId)
        .threadSettingsUpdate({ threadId: session.threadId, serviceTier: tier });
      // The RPC accepts a queued operation. Its live report confirms application.
      await Promise.race([
        report,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  "Codex did not report the requested speed setting within 10 seconds. Check the runtime connection and set speed explicitly.",
                ),
              ),
            10_000,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      delete session.pendingSpeedReport;
    }
  }

  async tier(
    client: CodexAppServerClient,
    runtimeId: string,
    modelId: string,
    choice: string,
  ): Promise<string | null> {
    if (choice === "standard") return null;
    const catalog = await this.context.models.list(client, runtimeId);
    const model = catalog.data.find((entry) => entry.model === modelId || entry.id === modelId);
    const tier = model?.serviceTiers.find((entry) => entry.id === choice);
    if (!tier)
      throw new Error(
        `Codex model '${modelId}' does not advertise the requested speed level. Select a supported model or select Standard.`,
      );
    return tier.id;
  }
}

// Codex reports explicit null as "default" to suppress the model's tier default.
export function codexServiceTier(tier: string | null): string | null {
  return tier === "default" ? null : tier;
}

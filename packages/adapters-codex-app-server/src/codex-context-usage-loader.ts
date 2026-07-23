import type { PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import { agentSessionRefsEqual } from "@openducktor/core";
import type { CodexLocalSessionState } from "./codex-local-session-state";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import {
  preserveRuntimeContextForExistingThread,
  sessionStateFromExistingThread,
} from "./codex-session-lifecycle";
import { codexTransportPolicy, requireCodexRuntimePolicy } from "./codex-session-policy";
import { codexSessionRef } from "./codex-session-ref";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexLiveSessionLocator, CodexSessionContextUsage } from "./types";

type ContextUsageLoadGuard = {
  refs: readonly SessionRef[];
  runtimeId: string | null;
  releasedRuntimeIds: Set<string>;
  error: Error | null;
  cancellation: Promise<never>;
  cancel: (error: Error) => void;
};

type CodexContextUsageLoaderDeps = {
  runtimeClients: CodexRuntimeClientResolver;
  runtimeEvents: CodexRuntimeSessionEvents;
  localSessions: CodexLocalSessionState;
  subagents: CodexSubagentLinkState;
  prepareRuntime(runtimeId: string): Promise<void>;
  clearThreadInventory(runtimeId: string): void;
};

export class CodexContextUsageLoader {
  private readonly inFlightLoads = new Set<ContextUsageLoadGuard>();

  constructor(private readonly deps: CodexContextUsageLoaderDeps) {}

  async loadSession(input: PolicyBoundSessionRef): Promise<CodexSessionContextUsage | null> {
    const session = this.deps.localSessions.get(input.externalSessionId);
    if (session) {
      return this.loadLive({ runtimeId: session.runtimeId, externalSessionId: session.threadId });
    }
    const guard = this.begin([input]);
    try {
      const runtime = await this.wait(
        guard,
        this.deps.runtimeClients.resolve(input, "load Codex session context usage"),
      );
      this.bindRuntime(guard, runtime.runtimeId);
      this.assertActive(guard);
      await this.wait(guard, this.deps.prepareRuntime(runtime.runtimeId));
      this.assertActive(guard);
      const policy = requireCodexRuntimePolicy(
        input.runtimePolicy,
        "load Codex session context usage",
      );
      return await this.wait(
        guard,
        this.deps.runtimeEvents.loadSessionContextUsage(
          runtime.runtimeId,
          input.externalSessionId,
          async () => {
            const response = await this.wait(
              guard,
              runtime.client.threadResume({
                ...codexTransportPolicy(policy),
                threadId: input.externalSessionId,
                cwd: input.workingDirectory,
                excludeTurns: false,
              }),
            );
            this.assertActive(guard);
            const recoveredSession = sessionStateFromExistingThread(
              input,
              runtime.runtimeId,
              input.model,
              response,
            );
            this.deps.localSessions.remember(
              preserveRuntimeContextForExistingThread(
                recoveredSession,
                this.deps.localSessions.get(input.externalSessionId),
              ),
            );
            this.deps.clearThreadInventory(runtime.runtimeId);
          },
        ),
      );
    } finally {
      this.inFlightLoads.delete(guard);
    }
  }

  async loadLive(input: CodexLiveSessionLocator): Promise<CodexSessionContextUsage | null> {
    const retained = this.deps.runtimeEvents.latestContextUsage(
      input.runtimeId,
      input.externalSessionId,
    );
    if (retained) {
      return retained;
    }
    const session = this.retainedLiveSession(input);
    const targetRef = {
      ...codexSessionRef(session),
      externalSessionId: input.externalSessionId,
    };
    const guard = this.begin(
      session.threadId === input.externalSessionId
        ? [targetRef]
        : [targetRef, codexSessionRef(session)],
    );
    this.bindRuntime(guard, input.runtimeId);
    try {
      await this.wait(guard, this.deps.prepareRuntime(input.runtimeId));
      this.assertActive(guard);
      const policy = requireCodexRuntimePolicy(
        session.runtimePolicy,
        "load Codex session context usage",
      );
      return await this.wait(
        guard,
        this.deps.runtimeEvents.loadSessionContextUsage(
          input.runtimeId,
          input.externalSessionId,
          async () => {
            await this.wait(
              guard,
              this.deps.runtimeClients.clientForRuntime(input.runtimeId).threadResume({
                ...codexTransportPolicy(policy),
                threadId: input.externalSessionId,
                cwd: session.workingDirectory,
                excludeTurns: false,
              }),
            );
            this.assertActive(guard);
            this.deps.clearThreadInventory(input.runtimeId);
          },
        ),
      );
    } finally {
      this.inFlightLoads.delete(guard);
    }
  }

  cancelSession(input: SessionRef): void {
    for (const guard of this.inFlightLoads) {
      if (guard.refs.some((ref) => agentSessionRefsEqual(ref, input))) {
        this.cancel(
          guard,
          new Error(
            `Codex session '${input.externalSessionId}' was released while loading context usage.`,
          ),
        );
      }
    }
  }

  cancelRuntime(runtimeId: string): void {
    for (const guard of this.inFlightLoads) {
      guard.releasedRuntimeIds.add(runtimeId);
      if (guard.runtimeId === runtimeId) {
        this.cancel(
          guard,
          new Error(`Codex runtime '${runtimeId}' was released while loading context usage.`),
        );
      }
    }
  }

  private begin(refs: readonly SessionRef[]): ContextUsageLoadGuard {
    let cancel: (error: Error) => void = () => {};
    const guard = {
      refs,
      runtimeId: null,
      releasedRuntimeIds: new Set<string>(),
      error: null,
      cancellation: new Promise<never>((_, reject) => {
        cancel = reject;
      }),
      cancel,
    };
    this.inFlightLoads.add(guard);
    return guard;
  }

  private retainedLiveSession(input: CodexLiveSessionLocator) {
    const visited = new Set<string>();
    let currentThreadId = input.externalSessionId;
    while (!visited.has(currentThreadId)) {
      visited.add(currentThreadId);
      const session = this.deps.localSessions.get(currentThreadId);
      if (session) {
        if (session.runtimeId !== input.runtimeId) {
          throw new Error(
            `Cannot load Codex session context usage because session '${input.externalSessionId}' belongs to runtime '${session.runtimeId}', not '${input.runtimeId}'.`,
          );
        }
        return session;
      }
      const route = this.deps.subagents.routeForChild(currentThreadId, input.runtimeId);
      if (!route || (route.runtimeId && route.runtimeId !== input.runtimeId)) {
        throw new Error(
          `Cannot load Codex session context usage because session '${input.externalSessionId}' is not retained by runtime '${input.runtimeId}'.`,
        );
      }
      currentThreadId = route.parentExternalSessionId;
    }
    throw new Error(
      `Cannot load Codex session context usage because session '${input.externalSessionId}' has a cyclic parent route in runtime '${input.runtimeId}'.`,
    );
  }

  private bindRuntime(guard: ContextUsageLoadGuard, runtimeId: string): void {
    guard.runtimeId = runtimeId;
    if (guard.releasedRuntimeIds.has(runtimeId)) {
      this.cancel(
        guard,
        new Error(`Codex runtime '${runtimeId}' was released while loading context usage.`),
      );
    }
  }

  private wait<Value>(guard: ContextUsageLoadGuard, operation: Promise<Value>): Promise<Value> {
    return Promise.race([operation, guard.cancellation]);
  }

  private assertActive(guard: ContextUsageLoadGuard): void {
    if (guard.error) {
      throw guard.error;
    }
  }

  private cancel(guard: ContextUsageLoadGuard, error: Error): void {
    if (guard.error) {
      return;
    }
    guard.error = error;
    guard.cancel(error);
  }
}

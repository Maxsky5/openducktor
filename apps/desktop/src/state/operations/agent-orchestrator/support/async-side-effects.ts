import { errorMessage } from "@/lib/errors";

type AsyncTagValue = string | number | boolean | null | undefined;

export type OrchestratorAsyncTags = Record<string, AsyncTagValue>;

export type OrchestratorAsyncFailure = {
  operation: string;
  reason: string;
  tags: OrchestratorAsyncTags;
  error: unknown;
};

type AsyncFailureOptions = {
  tags?: OrchestratorAsyncTags;
  onFailure?: (failure: OrchestratorAsyncFailure) => void;
};

type AsyncFallbackOptions<T> = AsyncFailureOptions & {
  fallback: (failure: OrchestratorAsyncFailure) => T;
};

const ORCHESTRATOR_ERROR_PREFIX = "[agent-orchestrator]";

const createOrchestratorAsyncFailure = (
  operation: string,
  error: unknown,
  tags?: OrchestratorAsyncTags,
): OrchestratorAsyncFailure => {
  return {
    operation,
    reason: errorMessage(error),
    tags: tags ?? {},
    error,
  };
};

const logOrchestratorAsyncFailure = (failure: OrchestratorAsyncFailure): void => {
  console.error(ORCHESTRATOR_ERROR_PREFIX, failure.operation, {
    reason: failure.reason,
    tags: failure.tags,
    error: failure.error,
  });
};

export const runOrchestratorSideEffect = (
  operation: string,
  effect: Promise<unknown>,
  options?: AsyncFailureOptions,
): void => {
  void effect.catch((error) => {
    const failure = createOrchestratorAsyncFailure(operation, error, options?.tags);
    logOrchestratorAsyncFailure(failure);
    options?.onFailure?.(failure);
  });
};

export const captureOrchestratorFallback = async <T>(
  operation: string,
  effect: () => Promise<T>,
  options: AsyncFallbackOptions<T>,
): Promise<T> => {
  try {
    return await effect();
  } catch (error) {
    const failure = createOrchestratorAsyncFailure(operation, error, options.tags);
    logOrchestratorAsyncFailure(failure);
    options.onFailure?.(failure);
    return options.fallback(failure);
  }
};

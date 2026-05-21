import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { toast } from "sonner";
import { host } from "../shared/host";

type Restore = () => void;

export const runOrchestratorOperationTest = async (run: () => Promise<void>) => {
  await run();
};

export const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
    reject: (reason?: unknown) => {
      reject?.(reason);
    },
  };
};

export const createPatchScope = () => {
  const restorers: Restore[] = [];
  const remember = (restore: Restore) => {
    restorers.push(restore);
  };

  return {
    patchHost<K extends keyof typeof host>(key: K, value: (typeof host)[K]) {
      const original = host[key];
      host[key] = value;
      remember(() => {
        host[key] = original;
      });
    },
    patchAdapterPrototype<K extends keyof OpencodeSdkAdapter>(
      key: K,
      value: OpencodeSdkAdapter[K],
    ) {
      const prototype = OpencodeSdkAdapter.prototype;
      const original = prototype[key];
      prototype[key] = value;
      remember(() => {
        prototype[key] = original;
      });
    },
    patchToastError(value: typeof toast.error) {
      const original = toast.error;
      toast.error = value;
      remember(() => {
        toast.error = original;
      });
    },
    restore() {
      for (const restore of restorers.splice(0).reverse()) {
        restore();
      }
    },
  };
};

export const runWithPatchScope = async (
  run: (scope: ReturnType<typeof createPatchScope>) => Promise<void>,
) => {
  const scope = createPatchScope();
  try {
    await run(scope);
  } finally {
    scope.restore();
  }
};

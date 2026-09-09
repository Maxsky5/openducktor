// Limit the complete read and decode operation, including uncancellable host reads.
let active = 0;
const waiting: (() => void)[] = [];

export const runImagePreview = async <T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> => {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", abort);
      active++;
      resolve();
    };
    const abort = () => {
      const index = waiting.indexOf(start);
      if (index !== -1) waiting.splice(index, 1);
      reject(signal.reason);
    };
    if (active < 2) start();
    else {
      waiting.push(start);
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  try {
    signal.throwIfAborted();
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
};

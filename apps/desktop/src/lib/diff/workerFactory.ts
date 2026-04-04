const workerUrl = new URL("./pierre-diff-worker.ts", import.meta.url);

export function workerFactory(): Worker {
  return new Worker(workerUrl, { type: "module" });
}

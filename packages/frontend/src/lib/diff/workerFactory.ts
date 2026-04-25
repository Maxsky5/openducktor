const workerUrl = new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url);

export function workerFactory(): Worker {
  return new Worker(workerUrl, { type: "module" });
}

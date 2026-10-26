/** A signal that follows its sources until `unlink` runs. */
export type LinkedSignal = { signal: AbortSignal; unlink: () => void };

/**
 * A signal that aborts when one of its sources aborts, with the reason of that source. Use it in
 * place of `AbortSignal.any` for a long-lived source. React Native keeps each `AbortSignal.any`
 * listener on its sources until a source aborts, so each request stays in memory as long as the
 * connection. Call `unlink` when the work ends, so the sources drop the listeners.
 */
export const linkSignals = (sources: readonly AbortSignal[]): LinkedSignal => {
  const controller = new AbortController();
  const abortedSource = sources.find((source) => source.aborted);
  if (abortedSource) {
    controller.abort(abortedSource.reason);
    return { signal: controller.signal, unlink: () => {} };
  }
  const links = sources.map((source) => {
    const forward = (): void => {
      unlink();
      controller.abort(source.reason);
    };
    source.addEventListener("abort", forward, { once: true });
    return { source, forward };
  });
  const unlink = (): void => {
    for (const { source, forward } of links) source.removeEventListener("abort", forward);
  };
  return { signal: controller.signal, unlink };
};

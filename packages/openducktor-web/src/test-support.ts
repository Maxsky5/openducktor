export const createFetchFixture = (
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch => Object.assign(implementation, { preconnect() {} });

export const createTimerFixture = (): ReturnType<typeof setTimeout> => {
  const timer = setTimeout(() => {}, 60_000);
  clearTimeout(timer);
  return timer;
};

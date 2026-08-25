export const createFetchFixture = (
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch => Object.assign(implementation, { preconnect() {} });

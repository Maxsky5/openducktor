import "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    /** The checkout of a Git directory read whose key ends with its checkout. */
    queryMeta: { checkoutIdentity?: string | null };
  }
}

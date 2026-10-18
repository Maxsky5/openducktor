import "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      /** The checkout of a Git directory read whose key ends with its checkout. */
      checkoutIdentity?: string | null;
      /**
       * Host recovery does not refetch this read. Use it for device reads that do not follow the
       * host and for reads that report their own failures.
       */
      skipHostRecovery?: true;
    };
  }
}

import tls from "node:tls";

/**
 * Adds the OS-trusted certificates to the default ones for outbound TLS on this thread, as
 * Electron does. A self-managed GitLab or Azure DevOps Server can then use a company CA.
 */
export const trustSystemCertificates = (): void => {
  // The default list holds the bundled roots and NODE_EXTRA_CA_CERTS. The call replaces it.
  tls.setDefaultCACertificates([
    ...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]),
  ]);
};

let systemCertificatesTrusted = false;

/**
 * The fetch of the REST Git providers. Reading the OS certificate store takes tens of
 * milliseconds, so it runs before the first provider request instead of at runner start.
 */
export const gitProviderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  if (!systemCertificatesTrusted) {
    trustSystemCertificates();
    systemCertificatesTrusted = true;
  }
  return fetch(input, init);
};

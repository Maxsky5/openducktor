/**
 * True for an image that a GitHub issue attaches: a `user-attachments/assets/<uuid>` address. A
 * private repository serves these images only with credentials, so clients load them through the
 * host.
 */
export const isGithubIssueAttachmentUrl = (url: string): boolean =>
  /^https:\/\/[^/]+\/user-attachments\/assets\/[a-f\d-]{36}$/iu.test(url);

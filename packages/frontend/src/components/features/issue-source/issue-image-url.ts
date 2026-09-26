export const isGithubIssueAttachmentUrl = (url: string): boolean =>
  /^https:\/\/[^/]+\/user-attachments\/assets\/[a-f\d-]{36}$/iu.test(url);

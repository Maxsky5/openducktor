/** An image that a GitHub issue attaches: a `user-attachments/assets/<uuid>` address. */
const GITHUB_ATTACHMENT_URL = /^https:\/\/[^/]+\/user-attachments\/assets\/[a-f\d-]{36}$/iu;

/**
 * An image that a GitLab issue attaches: a project upload with a 32-digit hex secret, as
 * `<instance>/<group...>/<project>/uploads/<secret>/<file>` or
 * `<instance>/-/project/<id>/uploads/<secret>/<file>`. The host checks the instance and project.
 */
const GITLAB_UPLOAD_URL = /^https?:\/\/[^/?#]+\/(?:[^?#]*\/)?uploads\/[a-f\d]{32}\/[^/?#]+$/iu;

/**
 * True for an image that the source issue of a task attaches. A private repository serves these
 * images only with credentials, so clients load them through the host with `issue_image_get`.
 */
export const isHostLoadedIssueImageUrl = (providerId: string, url: string): boolean => {
  switch (providerId) {
    case "github":
      return GITHUB_ATTACHMENT_URL.test(url);
    case "gitlab":
      return GITLAB_UPLOAD_URL.test(url);
    default:
      return false;
  }
};

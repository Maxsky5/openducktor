/** The OAuth application that OpenDucktor maintainers registered on GitLab.com for device sign-in. */
const DEFAULT_GITLAB_CLIENT_ID = "f867641f53b618afd629ed6200d083ae690826b618f8bd0a7e1a77181c30c5da";

export const resolveGitlabClientId = (processEnv: NodeJS.ProcessEnv): string | undefined => {
  const value = (processEnv.OPENDUCKTOR_GITLAB_CLIENT_ID ?? DEFAULT_GITLAB_CLIENT_ID).trim();
  return value === "" ? undefined : value;
};

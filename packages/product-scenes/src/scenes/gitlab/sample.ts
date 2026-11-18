// The sample data of the GitLab scene. The Fieldnotes repository has its origin remote on
// GitLab.com, in the fieldnotes-app group, as in the GitLab page of the documentation. A new GitLab
// provider starts on the GitLab.com instance, as gitlabDraftFromConfig gives it, and Detect from
// origin fills the project path. Browser sign-in links the account of the user sam. The one-time
// code and the display name are fictional. src/copied-gitlab.test.ts compares the instance, its
// label, and the detected project with the app.

/** GITLAB_COM_INSTANCE_URL of packages/contracts. */
export const INSTANCE_URL = "https://gitlab.com";

/** The label of the instance, as gitlabInstanceLabel gives it. */
export const INSTANCE_LABEL = "gitlab.com";

/** The project of the origin remote. */
export const PROJECT_PATH = "fieldnotes-app/fieldnotes";

/** The GitLab account that the sign-in links. */
export const ACCOUNT = { username: "sam", displayName: "Sam Rivera" } as const;

/** The one-time code of the sign-in, in the format of a GitLab user code. */
export const SIGN_IN_CODE = "QF7K2M9X";

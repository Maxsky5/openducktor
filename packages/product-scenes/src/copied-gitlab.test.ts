import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { connectedAs, GITLAB_ACCOUNT_TEXT } from "./replicas/settings/GitlabAccount";
import {
  GITLAB_CARD_TEXT,
  GITLAB_PROJECT_PATH_ERROR,
  GITLAB_READINESS,
} from "./replicas/settings/GitlabSetupCard";
import { AzureDevOpsIcon, GithubIcon, GitlabIcon } from "./replicas/settings/GitProviderIcons";
import { GIT_PROVIDER_OPTIONS, GIT_PROVIDER_TEXT } from "./replicas/settings/GitProviderSelector";
import { REPOSITORY_SECTIONS } from "./replicas/settings/RepositorySidebar";
import { ACCOUNT, INSTANCE_LABEL, INSTANCE_URL, PROJECT_PATH } from "./scenes/gitlab/sample";
import { importProduct, readProduct } from "./test-support/product-source";

type GitlabDraft = {
  instanceUrl: string;
  projectPath: string;
  accountId: string | null;
  remoteName: string;
  httpConsentInstanceUrl: string | null;
};
type ReadinessInput = {
  enabled: boolean;
  draft: GitlabDraft;
  status: { status: "ready"; account: { tokenExpiresAt: string | null } } | null;
};
type Descriptor = { label: string };

const SETTINGS = "packages/frontend/src/components/features/settings";

// SAFETY: gitlab-provider-model.ts exports these functions, and a missing export fails the test.
const model = await importProduct<{
  gitlabDraftFromConfig: (config: undefined) => GitlabDraft;
  applyGitlabOrigin: (
    draft: GitlabDraft,
    origin: { providerId: "gitlab"; instanceUrl: string; projectPath: string },
  ) => GitlabDraft;
  gitlabReadiness: (input: ReadinessInput) => { label: string; variant: string };
  gitlabDraftErrors: (draft: GitlabDraft) => { instanceUrl?: string; projectPath?: string };
}>(`${SETTINGS}/gitlab-provider-model.ts`);
// SAFETY: gitlab-repository-identity.ts exports this function, and a missing export fails the test.
const { gitlabInstanceLabel } = await importProduct<{
  gitlabInstanceLabel: (instanceUrl: string) => string;
}>("packages/core/src/services/gitlab-repository-identity.ts");
// SAFETY: the contracts export the provider descriptors and the GitLab.com instance.
const contracts = await importProduct<{
  GITHUB_PROVIDER_DESCRIPTOR: Descriptor;
  GITLAB_PROVIDER_DESCRIPTOR: Descriptor;
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR: Descriptor;
  GITLAB_COM_INSTANCE_URL: string;
}>("packages/contracts/src/index.ts");
// SAFETY: settings-modal-constants.ts exports the sections, and a missing export fails the test.
const { REPOSITORY_SECTIONS: APP_SECTIONS } = await importProduct<{
  REPOSITORY_SECTIONS: readonly { label: string }[];
}>(`${SETTINGS}/settings-modal-constants.ts`);
// SAFETY: git-provider-icons.tsx exports the three marks, and a missing export fails the test.
const icons = await importProduct<{
  GithubIcon: ComponentType;
  GitlabIcon: ComponentType;
  AzureDevOpsIcon: ComponentType;
}>(`${SETTINGS}/git-provider-icons.tsx`);
// The card has its words in its markup, so the test reads the product source as text.
const cardSource = (
  await Promise.all(
    [
      "git-provider-selector.tsx",
      "provider-setup-card.tsx",
      "gitlab-editor-card.tsx",
      "gitlab-provider-fields.tsx",
      "gitlab-account-panel.tsx",
      "settings-modal-sidebars.tsx",
    ].map((file) => readProduct(`${SETTINGS}/${file}`)),
  )
).join("\n");

/** The paths of an icon, as React renders them. */
function paths(Icon: ComponentType): string[] {
  const markup = renderToStaticMarkup(createElement(Icon));
  return [...markup.matchAll(/ d="([^"]+)"/g)].flatMap((match) => (match[1] ? [match[1]] : []));
}

/** A GitLab draft of the scene: the GitLab.com instance, the project, and the account. */
const draft = (projectPath: string, accountId: string | null): GitlabDraft => ({
  ...model.gitlabDraftFromConfig(undefined),
  projectPath,
  accountId,
});

describe("the GitLab settings copied from the app", () => {
  test("the provider tiles have the labels of the provider descriptors", () => {
    expect([
      "No provider",
      contracts.GITHUB_PROVIDER_DESCRIPTOR.label,
      contracts.GITLAB_PROVIDER_DESCRIPTOR.label,
      contracts.AZURE_DEVOPS_PROVIDER_DESCRIPTOR.label,
    ]).toEqual(GIT_PROVIDER_OPTIONS.map(({ label }) => label));
    expect(cardSource).toContain('label: "No provider"');
  });

  test("the provider marks have the geometry of the app", () => {
    expect(paths(GitlabIcon)).toEqual(paths(icons.GitlabIcon));
    expect(paths(AzureDevOpsIcon)).toEqual(paths(icons.AzureDevOpsIcon));
    expect(paths(GithubIcon)).toEqual(paths(icons.GithubIcon));
  });

  test("the repository menu lists the sections of the app", () => {
    expect(APP_SECTIONS.map(({ label }) => label)).toEqual([...REPOSITORY_SECTIONS]);
  });

  test("a new provider starts on GitLab.com, and Detect from origin fills the project", () => {
    expect(INSTANCE_URL).toBe(contracts.GITLAB_COM_INSTANCE_URL);
    expect(model.gitlabDraftFromConfig(undefined)).toMatchObject({
      instanceUrl: INSTANCE_URL,
      projectPath: "",
    });
    const origin = {
      providerId: "gitlab",
      instanceUrl: INSTANCE_URL,
      projectPath: PROJECT_PATH,
    } as const;
    expect(model.applyGitlabOrigin(draft("", null), origin).projectPath).toBe(PROJECT_PATH);
    expect(gitlabInstanceLabel(INSTANCE_URL)).toBe(INSTANCE_LABEL);
  });

  test("a linked account shows the title of the app", () => {
    expect(cardSource).toContain(
      "`Connected as @${account.username} on ${gitlabInstanceLabel(instanceUrl)}`",
    );
    expect(connectedAs(ACCOUNT.username, gitlabInstanceLabel(INSTANCE_URL))).toBe(
      `Connected as @${ACCOUNT.username} on ${INSTANCE_LABEL}`,
    );
  });

  test("the empty project path shows its error until Detect from origin fills it", () => {
    expect(model.gitlabDraftErrors(draft("", null))).toEqual({
      projectPath: GITLAB_PROJECT_PATH_ERROR,
    });
    expect(model.gitlabDraftErrors(draft(PROJECT_PATH, null))).toEqual({});
    expect(cardSource).toContain("error={errors.projectPath}");
  });

  test("the readiness badge follows the readiness of the app", () => {
    const ready = { status: "ready", account: { tokenExpiresAt: null } } as const;
    const states = {
      link: { enabled: true, draft: draft("", null), status: null },
      connect: { enabled: true, draft: draft(PROJECT_PATH, null), status: null },
      checking: { enabled: true, draft: draft(PROJECT_PATH, "account-1"), status: null },
      ready: { enabled: true, draft: draft(PROJECT_PATH, "account-1"), status: ready },
    } satisfies Record<keyof typeof GITLAB_READINESS, ReadinessInput>;
    for (const state of ["link", "connect", "checking", "ready"] as const) {
      const { label, variant } = model.gitlabReadiness(states[state]);
      expect({ label, variant }).toEqual(GITLAB_READINESS[state]);
    }
  });

  test("the card uses the words of the app", () => {
    expect(`${contracts.GITLAB_PROVIDER_DESCRIPTOR.label} setup`).toBe(GITLAB_CARD_TEXT.title);
    expect(cardSource).toContain("{providerLabel} setup");
    const { title: _title, ...words } = GITLAB_CARD_TEXT;
    for (const text of [
      ...Object.values(GIT_PROVIDER_TEXT),
      ...Object.values(words),
      ...Object.values(GITLAB_ACCOUNT_TEXT),
      "Repository",
    ])
      expect(cardSource).toContain(text);
  });
});

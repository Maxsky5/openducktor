// The Git settings of a repository: the provider tiles of GitProviderSelector.tsx and the GitLab
// setup card of GitlabSetupCard.tsx. The steps change the view as the app does when the visitor
// picks a provider, reads the origin remote, and connects an account. The app renders each change
// at once, so no step adds a tween.
import { all, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { GitlabAccountStep } from "./GitlabAccount";
import { GITLAB_READINESS, type GitlabReadiness } from "./GitlabSetupCard";
import type { GitProviderId } from "./GitProviderSelector";

/** The Git settings in `root`. */
export function gitSettings(scene: Scene, root: HTMLElement) {
  const card = must(root, "[data-gitlab-card]");
  const badge = must(card, "[data-card-head] [data-readiness]");
  const detectButton = must(card, "[data-detect]");
  const account = must(card, "[data-gitlab-account]");
  const step = (name: GitlabAccountStep): HTMLElement =>
    must(account, `[data-account-step="${name}"]`);
  const tile = (provider: GitProviderId): HTMLElement =>
    must(root, `[data-provider="${provider}"]`);
  const field = (name: "instance-url" | "project-path"): HTMLElement =>
    must(card, `[data-field="${name}"]`);

  const selectNow = (provider: GitProviderId): void => {
    for (const option of all(root, "[data-provider]"))
      option.toggleAttribute("data-selected", option.dataset.provider === provider);
    card.hidden = provider !== "gitlab";
  };

  const setReadiness = (state: GitlabReadiness): void => {
    const { label, variant } = GITLAB_READINESS[state];
    badge.dataset.variant = variant;
    badge.textContent = label;
  };

  /** Writes the value of a field. An empty Project path shows its error. */
  const setField = (name: "instance-url" | "project-path", value: string): void => {
    const input = field(name);
    must(input, "[data-typed]").textContent = value;
    input.toggleAttribute("data-filled", value !== "");
  };

  const showStep = (name: GitlabAccountStep): void => {
    for (const element of all(account, "[data-account-step]"))
      element.hidden = element.dataset.accountStep !== name;
  };

  /**
   * Build time: no provider is selected, and the GitLab card, which shows when the visitor picks
   * GitLab, has the draft of a new GitLab provider: the GitLab.com instance, no project, and no
   * account.
   */
  const reset = (instanceUrl: string): void => {
    selectNow("none");
    setReadiness("link");
    setField("instance-url", instanceUrl);
    setField("project-path", "");
    showStep("connect");
  };

  /** Selects the provider at `at`. The GitLab card shows at once when GitLab is selected. */
  const select = (provider: GitProviderId, at: number): void =>
    scene.at(at, () => selectNow(provider));

  /** The readiness badge shows `state` at `at`. */
  const readiness = (state: GitlabReadiness, at: number): void =>
    scene.at(at, () => setReadiness(state));

  /**
   * Detect from origin reads the origin remote from `at` for `seconds`, then fills the project
   * path, and the error of the empty path goes. Returns the time when the fields are filled.
   */
  const detect = (projectPath: string, at: number, seconds: number): number => {
    scene.at(at, () => detectButton.toggleAttribute("data-detecting", true));
    const done = at + seconds;
    scene.at(done, () => {
      detectButton.removeAttribute("data-detecting");
      setField("project-path", projectPath);
    });
    return done;
  };

  /**
   * Sign in with GitLab starts the sign-in at `at`: the account part locks, and the button spins
   * for `seconds`. Then the part shows the one-time code while the browser asks for the approval.
   * Returns the time when the code shows.
   */
  const startSignIn = (at: number, seconds: number): number => {
    const connect = step("connect");
    scene.at(at, () => connect.toggleAttribute("data-starting", true));
    const shown = at + seconds;
    scene.at(shown, () => {
      connect.removeAttribute("data-starting");
      showStep("pending");
    });
    return shown;
  };

  /**
   * The approval links the account at `at`. The app checks the connection for `seconds`, then the
   * card is ready. Returns the time when the card is ready.
   */
  const link = (at: number, seconds: number): number => {
    const linked = step("linked");
    scene.at(at, () => {
      linked.toggleAttribute("data-checking", true);
      showStep("linked");
    });
    readiness("checking", at);
    const ready = at + seconds;
    scene.at(ready, () => linked.removeAttribute("data-checking"));
    readiness("ready", ready);
    return ready;
  };

  return {
    tile,
    detectButton: (): HTMLElement => detectButton,
    signInButton: (): HTMLElement => must(step("connect"), "[data-sign-in]"),
    reset,
    select,
    readiness,
    detect,
    startSignIn,
    link,
  };
}

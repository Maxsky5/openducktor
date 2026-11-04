import type { GitlabRepository } from "@openducktor/contracts";
import { useRef, useState } from "react";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  applyGitlabOrigin,
  type GitlabDraft,
  gitlabDraftInstanceUrl,
} from "./gitlab-provider-model";
import { useGitlabAccountController } from "./use-gitlab-account-controller";

export type GitlabDraftState = { draft: GitlabDraft; enabled: boolean };

/** Where a GitLab draft lives: the Settings form or the workspace setup draft. */
export type GitlabDraftOwner = {
  /** The latest draft and switch state, or null when GitLab is no longer the chosen provider. */
  read(): GitlabDraftState | null;
  write(next: GitlabDraftState): void;
};

/**
 * Edits one GitLab draft for Settings and workspace setup. Account replies, sign-in, and Detect
 * from origin can end after the user changed the draft, so every late result goes through one
 * rule: it reads the latest draft from the owner and applies only while that draft still wants
 * it. A user edit or a switch change counts as a new draft version.
 */
export function useGitlabDraftEditor({
  state,
  fromSavedSettings,
  owner,
  detectOrigin,
}: {
  /** The draft of this render. */
  state: GitlabDraftState;
  /** Settings opens a saved draft. Workspace setup builds a new one. */
  fromSavedSettings: boolean;
  owner: GitlabDraftOwner;
  /** Reads the GitLab project of the origin remote, or null when it names none. */
  detectOrigin: () => Promise<GitlabRepository | null>;
}) {
  const versionRef = useRef(0);
  const mountedRef = useMountedRef();
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const latest = (): GitlabDraftState | null => (mountedRef.current ? owner.read() : null);

  /** Applies a late result to the latest draft. `change` returns null to drop the result. */
  const applyLate = (change: (draft: GitlabDraft) => GitlabDraft | null): GitlabDraft | null => {
    const current = latest();
    const next = current ? change(current.draft) : null;
    if (current && next) owner.write({ draft: next, enabled: current.enabled });
    return next;
  };

  const account = useGitlabAccountController({
    draft: state.draft,
    enabled: state.enabled,
    fromSavedSettings,
    onLink: (accountId, instanceUrl) =>
      applyLate((draft) =>
        gitlabDraftInstanceUrl(draft) === instanceUrl ? { ...draft, accountId } : null,
      ),
  });

  const write = (next: GitlabDraftState) => {
    versionRef.current += 1;
    owner.write(next);
  };

  const edit = (draft: GitlabDraft) => {
    write({ draft, enabled: latest()?.enabled ?? state.enabled });
    account.afterDraftChange(draft);
  };

  const detectFromOrigin = async () => {
    setDetecting(true);
    setDetectError(null);
    const version = versionRef.current;
    try {
      const origin = await detectOrigin();
      if (!origin)
        setDetectError("The origin remote does not name a GitLab project. Enter it below.");
      // An edit or a switch change during detection wins over the detected project.
      else if (versionRef.current === version) {
        const next = applyLate((draft) => applyGitlabOrigin(draft, origin));
        if (next) account.afterDraftChange(next);
      }
    } catch (cause) {
      setDetectError(`Detect from origin failed: ${errorMessage(cause)}`);
    } finally {
      if (mountedRef.current) setDetecting(false);
    }
  };

  return {
    account,
    edit,
    setEnabled: (enabled: boolean) => write({ draft: latest()?.draft ?? state.draft, enabled }),
    detectFromOrigin: () => void detectFromOrigin(),
    detecting,
    detectError,
  };
}

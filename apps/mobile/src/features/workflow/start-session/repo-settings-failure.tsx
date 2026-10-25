import type { ReactElement } from "react";
import { ErrorState } from "@/ui/states";

/**
 * The repository settings did not load, so a start cannot use the default runtime, model, effort,
 * and target branch of the repository. The sheet waits for Retry instead of starting without them.
 */
export function RepoSettingsFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): ReactElement {
  return (
    <ErrorState
      title="Repository Settings Did Not Load"
      message={`${message} The start needs the default models of the repository.`}
      onRetry={onRetry}
    />
  );
}

import type { ReactElement } from "react";
import { ErrorState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Button } from "@/ui/button";

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
      title="Could not load repository settings"
      message={`${message} The start needs the default models of the repository.`}
      onRetry={onRetry}
    />
  );
}

export function RepoSettingsRefreshNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): ReactElement {
  return (
    <Callout
      tone="warning"
      title="Repository settings could not refresh"
      message={message}
      action={
        <Button
          label="Retry settings"
          icon="refresh"
          variant="outline"
          onPress={() => void onRetry()}
        />
      }
    />
  );
}

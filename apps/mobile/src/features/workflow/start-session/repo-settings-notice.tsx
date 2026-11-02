import type { ReactElement } from "react";
import { Callout } from "@/ui/callout";
import { Button } from "@/ui/button";

/** Read failures stay beside the choices, so retry keeps the user's edits. */
export function RepoSettingsNotice({
  error,
  refreshError,
  onRetry,
}: {
  error: string | null;
  refreshError: string | null;
  onRetry: () => Promise<void>;
}): ReactElement | null {
  const message = error ?? refreshError;
  if (!message) return null;
  return (
    <Callout
      tone={error ? "destructive" : "warning"}
      title={error ? "Repository settings did not load" : "Repository settings could not refresh"}
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

import { useInlineStartupLease } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { useIsFocused } from "expo-router";

/**
 * Holds a store-owned inline startup lease while the hosting screen has focus.
 * Renders nothing so focus changes (such as a sheet opening over the screen) only re-render this leaf.
 */
export function InlineStartupLease({
  attemptId,
  suppressBackground,
}: {
  attemptId: string | null | undefined;
  suppressBackground?: (() => boolean) | undefined;
}): null {
  const isFocused = useIsFocused();
  useInlineStartupLease(
    { attemptId },
    isFocused,
    suppressBackground
      ? { returnFromNotification: true, suppressBackground }
      : { returnFromNotification: true },
  );
  return null;
}

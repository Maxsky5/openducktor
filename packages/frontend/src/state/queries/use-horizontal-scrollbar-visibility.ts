import {
  DEFAULT_APPEARANCE_SETTINGS,
  type HorizontalScrollbarVisibility,
  resolveHorizontalScrollbarVisibility,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { platformQueryOptions } from "./system";

type UseHorizontalScrollbarVisibilityArgs = {
  enabled: boolean;
  visibility: HorizontalScrollbarVisibility | undefined;
};

type HorizontalScrollbarVisibilityState = {
  showHorizontalScrollbars: boolean;
  isResolvingPlatformDefault: boolean;
  platformError: Error | null;
};

export const useHorizontalScrollbarVisibility = ({
  enabled,
  visibility,
}: UseHorizontalScrollbarVisibilityArgs): HorizontalScrollbarVisibilityState => {
  const horizontalScrollbarVisibility =
    visibility ?? DEFAULT_APPEARANCE_SETTINGS.horizontalScrollbarVisibility;
  const shouldResolvePlatform = enabled && horizontalScrollbarVisibility === "system";
  const platformQuery = useQuery({
    ...platformQueryOptions(),
    enabled: shouldResolvePlatform,
  });

  const showHorizontalScrollbars = useMemo(() => {
    if (horizontalScrollbarVisibility !== "system") {
      return horizontalScrollbarVisibility === "show";
    }

    if (!platformQuery.data) {
      return false;
    }

    return (
      resolveHorizontalScrollbarVisibility(horizontalScrollbarVisibility, platformQuery.data) ===
      "show"
    );
  }, [horizontalScrollbarVisibility, platformQuery.data]);

  return {
    showHorizontalScrollbars,
    isResolvingPlatformDefault: shouldResolvePlatform && platformQuery.isPending,
    platformError: shouldResolvePlatform && platformQuery.isError ? platformQuery.error : null,
  };
};

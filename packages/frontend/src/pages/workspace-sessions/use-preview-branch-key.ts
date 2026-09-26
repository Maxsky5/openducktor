import { useEffect, useRef, useState } from "react";

export function usePreviewBranchKey(branch: string | null): number {
  const previousBranch = useRef<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (branch === null) return;
    const previous = previousBranch.current;
    previousBranch.current = branch;
    if (previous !== null && previous !== branch) setKey((current) => current + 1);
  }, [branch]);

  return key;
}

export const formatAgentDuration = (durationMs: number): string => {
  if (durationMs < 1_000) {
    return `${Math.max(1, Math.round(durationMs))}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    if (minutes > 0 && seconds > 0) {
      return `${hours}h${minutes}m${seconds}s`;
    }
    if (minutes > 0) {
      return `${hours}h${minutes}m`;
    }
    if (seconds > 0) {
      return `${hours}h${seconds}s`;
    }
    return `${hours}h`;
  }

  if (seconds > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${minutes}m`;
};

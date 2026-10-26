export const gitRefreshPriority = (mode: "hard" | "soft" | "scheduled"): number => {
  switch (mode) {
    case "hard":
      return 3;
    case "soft":
      return 2;
    case "scheduled":
      return 1;
  }
};

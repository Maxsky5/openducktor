const CSH_SHELL_NAMES = new Set(["csh", "tcsh"]);

export const isCshShell = (shellName: string): boolean => CSH_SHELL_NAMES.has(shellName);

/** The flag that runs one command in the login shell. csh and tcsh reject `-ilc`. */
export const loginCommandFlag = (shellName: string): "-ic" | "-ilc" =>
  isCshShell(shellName) ? "-ic" : "-ilc";

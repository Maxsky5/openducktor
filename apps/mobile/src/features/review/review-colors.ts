import type { AppTheme } from "@/theme/tokens";

export const gitPanelColors = (theme: AppTheme) => {
  const light = theme.scheme === "light";
  return {
    /** Modified and submodule file icons. */
    modified: light ? theme.palette.blue600 : theme.palette.blue400,
    /** Added file icons and line counts. */
    added: light ? theme.palette.green800 : theme.palette.green400,
    /** Deleted file icons and removed line counts. */
    deleted: light ? theme.palette.red700 : theme.palette.red400,
    /** The line totals of the list header, as `text-green-500` and `text-red-500`. */
    totalAdded: theme.palette.green500,
    totalDeleted: theme.palette.red500,
    /** The commit counts of the branch card, as `text-emerald-600` and `text-rose-600`. */
    ahead: light ? theme.palette.emerald600 : theme.palette.emerald400,
    behind: light ? theme.palette.rose600 : theme.palette.rose400,
    /** The conflict warning icon, as `text-amber-600 dark:text-amber-400`. */
    conflict: light ? theme.palette.amber600 : theme.palette.amber400,
  };
};

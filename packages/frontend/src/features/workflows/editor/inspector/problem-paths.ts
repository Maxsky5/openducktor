/** Whether a problem path starts with one of the roots, such as `guards` or `agent`. */
export const hasProblemUnder = (
  problemPaths: ReadonlySet<string>,
  roots: readonly string[],
  except: ReadonlySet<string> = new Set(),
): boolean =>
  [...problemPaths].some(
    (path) =>
      !except.has(path) &&
      roots.some(
        (root) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`),
      ),
  );

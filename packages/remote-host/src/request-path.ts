/** Maps both proxy forms to the same route. */
export const stripMountPath = (pathname: string, mountPath?: string): string =>
  mountPath && (pathname === mountPath || pathname.startsWith(`${mountPath}/`))
    ? pathname.slice(mountPath.length) || "/"
    : pathname;

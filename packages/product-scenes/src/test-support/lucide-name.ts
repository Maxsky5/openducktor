// The name of a lucide-react icon in the icon set of Lucide, which the mobile app names its icons
// with.

/** The Lucide name of a lucide-react icon, such as git-pull-request for GitPullRequest. */
export function lucideName(displayName: string | undefined): string {
  return (displayName ?? "").replace(/[a-z0-9](?=[A-Z])/g, "$&-").toLowerCase();
}

import type { ComponentProps } from "react";

// The same marks as the provider tiles of the app, in packages/frontend git-provider-icons.tsx.
const BRAND_PATHS = {
  GitHub:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  GitLab:
    "m23.6 9.593-.033-.086L20.3.98a.851.851 0 0 0-.336-.405.875.875 0 0 0-1 .054.875.875 0 0 0-.29.44L16.47 7.818H7.537L5.332 1.07a.857.857 0 0 0-.29-.441.875.875 0 0 0-1-.054.859.859 0 0 0-.336.405L.433 9.502l-.032.086a6.066 6.066 0 0 0 2.012 7.01l.011.009.03.021 4.976 3.727 2.462 1.863 1.5 1.132a1.009 1.009 0 0 0 1.22 0l1.499-1.132 2.461-1.863 5.006-3.749.013-.01a6.068 6.068 0 0 0 2.01-7.003z",
  AzureDevOps:
    "M0 8.899l2.247-2.966 8.405-3.416V.045l7.37 5.393L2.966 8.36v8.224L0 15.73zm24-4.45v14.652L18.247 24l-9.303-3.056V24l-5.978-7.416 15.057 1.798V5.438z",
};

/** The name of a brand logo, such as `GitHub`. */
export type BrandName = keyof typeof BRAND_PATHS;

export function isBrandName(name: string): name is BrandName {
  return Object.hasOwn(BRAND_PATHS, name);
}

/** A brand logo, in the text color, at the size of a Lucide icon. */
export function BrandIcon({ name, ...props }: { name: BrandName } & ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      {...props}
    >
      <path d={BRAND_PATHS[name]} />
    </svg>
  );
}

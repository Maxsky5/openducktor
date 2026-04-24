export function getAppVersion(): string | null {
  return import.meta.env.VITE_ODT_APP_VERSION || null;
}

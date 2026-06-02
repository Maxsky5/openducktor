export const validateExternalBrowserUrl = (url: string): string => {
  const trimmedUrl = url.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error("OpenDucktor web can only open absolute http or https URLs.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("OpenDucktor web can only open http or https URLs.");
  }

  return parsedUrl.href;
};

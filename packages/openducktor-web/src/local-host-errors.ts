export const readLocalHostErrorPayload = async (
  response: Response,
): Promise<{ message: string; payload: unknown | null }> => {
  const text = await response.text().catch(() => "");
  const trimmedText = text.trim();

  if (trimmedText) {
    try {
      const payload = JSON.parse(trimmedText) as { error?: unknown; message?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return { message: payload.error, payload };
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        return { message: payload.message, payload };
      }
    } catch {}

    return { message: trimmedText, payload: null };
  }

  return {
    message: `OpenDucktor web host request failed with status ${response.status}.`,
    payload: null,
  };
};

import { createStore } from "zustand/vanilla";

/** The text of the last scanned host QR code. The Add host form reads it once. */
export const scannedAddress = createStore<{ value: string | null }>(() => ({ value: null }));

export const takeScannedAddress = (): string | null => {
  const { value } = scannedAddress.getState();
  if (value !== null) scannedAddress.setState({ value: null });
  return value;
};

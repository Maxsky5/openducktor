import { mock } from "bun:test";
import { toast } from "sonner";

export const withMockedToast = async (
  callback: (mocks: {
    toastSuccessMock: ReturnType<typeof mock>;
    toastErrorMock: ReturnType<typeof mock>;
    toastInfoMock: ReturnType<typeof mock>;
  }) => Promise<void>,
): Promise<void> => {
  const originalSuccess = toast.success;
  const originalError = toast.error;
  const originalInfo = toast.info;
  const toastSuccessMock = mock(() => "");
  const toastErrorMock = mock(() => "");
  const toastInfoMock = mock(() => "");

  toast.success = toastSuccessMock;
  toast.error = toastErrorMock;
  toast.info = toastInfoMock;

  if (
    toast.success !== toastSuccessMock ||
    toast.error !== toastErrorMock ||
    toast.info !== toastInfoMock
  ) {
    throw new Error("withMockedToast: toast properties are not writable");
  }

  try {
    await callback({ toastSuccessMock, toastErrorMock, toastInfoMock });
  } finally {
    toast.success = originalSuccess;
    toast.error = originalError;
    toast.info = originalInfo;
  }
};

import { mock } from "bun:test";
import { toast } from "sonner";

export const withMockedToast = async (
  callback: (mocks: {
    toastSuccessMock: ReturnType<typeof mock>;
    toastErrorMock: ReturnType<typeof mock>;
  }) => Promise<void>,
): Promise<void> => {
  const originalSuccess = toast.success;
  const originalError = toast.error;
  const toastSuccessMock = mock(() => "");
  const toastErrorMock = mock(() => "");

  toast.success = toastSuccessMock;
  toast.error = toastErrorMock;

  try {
    await callback({ toastSuccessMock, toastErrorMock });
  } finally {
    toast.success = originalSuccess;
    toast.error = originalError;
  }
};

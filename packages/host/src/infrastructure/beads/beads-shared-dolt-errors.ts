import {
  HostOperationError,
  HostPathAccessError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";

export const sharedDoltOperationError = (
  message: string,
  operation: string,
  cause?: unknown,
): HostOperationError => new HostOperationError({ message, operation, cause });

export const sharedDoltResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });

export const sharedDoltValidationError = (
  message: string,
  field: string,
  cause?: unknown,
): HostValidationError => new HostValidationError({ message, field, cause });

export type SharedDoltServerError =
  | HostOperationError
  | HostPathAccessError
  | HostResourceError
  | HostValidationError;

export const toSharedDoltServerError = (
  cause: unknown,
  operation: string,
): SharedDoltServerError => {
  if (
    cause instanceof HostOperationError ||
    cause instanceof HostPathAccessError ||
    cause instanceof HostResourceError ||
    cause instanceof HostValidationError
  ) {
    return cause;
  }

  return sharedDoltOperationError(String(cause), operation, cause);
};

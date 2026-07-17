export const runElectronMainTask = (
  operation: () => void | Promise<void>,
  reportFailure: (cause: unknown) => void,
): void => {
  try {
    void Promise.resolve(operation()).catch(reportFailure);
  } catch (cause) {
    reportFailure(cause);
  }
};

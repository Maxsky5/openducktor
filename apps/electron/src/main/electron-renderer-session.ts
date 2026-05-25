export const ELECTRON_RENDERER_SESSION_PARTITION = "persist:openducktor";

type ElectronSessionModule<TSession> = {
  fromPartition(partition: string): TSession;
};

export const resolveElectronRendererSession = <TSession>(
  sessionModule: ElectronSessionModule<TSession>,
): TSession => sessionModule.fromPartition(ELECTRON_RENDERER_SESSION_PARTITION);

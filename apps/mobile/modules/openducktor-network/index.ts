import { requireNativeModule } from "expo";
import type { OpenDucktorNetworkModule } from "./src/OpenDucktorNetwork.types";

export type {
  NativeHttpHead,
  NativeNetworkErrorCode,
  OpenDucktorNetworkModule,
} from "./src/OpenDucktorNetwork.types";

export const OpenDucktorNetwork =
  requireNativeModule<OpenDucktorNetworkModule>("OpenDucktorNetwork");

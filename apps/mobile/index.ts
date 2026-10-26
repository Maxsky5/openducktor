// Order matters: globals and themes must exist before any route module loads.
import "./src/platform/install-globals";
import "./src/platform/zod-config";
import "./src/theme/unistyles";
import "expo-router/entry";

// React Native's WebSocket (Libraries/WebSocket/WebSocket.js) has these members at runtime. Its
// global type declaration omits them. The test project uses the Bun and DOM declarations instead.
interface WebSocket {
  binaryType: "blob" | "arraybuffer";
  readonly protocol: string;
}

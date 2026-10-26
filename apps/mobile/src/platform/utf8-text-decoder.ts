/**
 * A WHATWG UTF-8 decoder with the `fatal` and `stream` options that the remote stream parser uses,
 * and the `ignoreBOM` option that keeps the literal text of a task artifact.
 * The app installs it only when the runtime decoder fails the startup probe.
 */
export class Utf8TextDecoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  #codePoint = 0;
  #bytesNeeded = 0;
  #bytesSeen = 0;
  #lower = 0x80;
  #upper = 0xbf;
  #bomChecked = false;

  constructor(label = "utf-8", options?: { fatal?: boolean; ignoreBOM?: boolean }) {
    const normalized = label.trim().toLowerCase();
    if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
      throw new RangeError(`The "${label}" encoding is not supported.`);
    }
    this.fatal = options?.fatal ?? false;
    this.ignoreBOM = options?.ignoreBOM ?? false;
    this.#bomChecked = this.ignoreBOM;
  }

  decode(input?: Uint8Array | ArrayBuffer, options?: { stream?: boolean }): string {
    const bytes =
      input instanceof ArrayBuffer ? new Uint8Array(input) : (input ?? new Uint8Array());
    const codePoints: number[] = [];
    let output = "";
    const emit = (codePoint: number) => {
      if (!this.#bomChecked) {
        this.#bomChecked = true;
        if (codePoint === 0xfeff) return;
      }
      codePoints.push(codePoint);
      if (codePoints.length >= 4096) {
        output += String.fromCodePoint(...codePoints);
        codePoints.length = 0;
      }
    };
    const fail = () => {
      this.#reset();
      if (this.fatal) {
        this.#bomChecked = this.ignoreBOM;
        throw new TypeError("The encoded data was not valid UTF-8.");
      }
      emit(0xfffd);
    };
    let index = 0;
    while (index < bytes.length) {
      const byte = bytes[index] ?? 0;
      if (this.#bytesNeeded === 0) {
        index += 1;
        if (byte <= 0x7f) emit(byte);
        else if (byte >= 0xc2 && byte <= 0xdf) this.#start(1, byte & 0x1f);
        else if (byte >= 0xe0 && byte <= 0xef) {
          if (byte === 0xe0) this.#lower = 0xa0;
          if (byte === 0xed) this.#upper = 0x9f;
          this.#start(2, byte & 0x0f);
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          if (byte === 0xf0) this.#lower = 0x90;
          if (byte === 0xf4) this.#upper = 0x8f;
          this.#start(3, byte & 0x07);
        } else fail();
        continue;
      }
      if (byte < this.#lower || byte > this.#upper) {
        // The byte starts a new sequence, so it is read again after the error.
        fail();
        continue;
      }
      index += 1;
      this.#lower = 0x80;
      this.#upper = 0xbf;
      this.#codePoint = (this.#codePoint << 6) | (byte & 0x3f);
      this.#bytesSeen += 1;
      if (this.#bytesSeen === this.#bytesNeeded) {
        const codePoint = this.#codePoint;
        this.#reset();
        emit(codePoint);
      }
    }
    if (!options?.stream) {
      if (this.#bytesNeeded !== 0) fail();
      this.#bomChecked = this.ignoreBOM;
    }
    return output + String.fromCodePoint(...codePoints);
  }

  #start(bytesNeeded: number, codePoint: number): void {
    this.#bytesNeeded = bytesNeeded;
    this.#codePoint = codePoint;
  }

  #reset(): void {
    this.#codePoint = 0;
    this.#bytesNeeded = 0;
    this.#bytesSeen = 0;
    this.#lower = 0x80;
    this.#upper = 0xbf;
  }
}

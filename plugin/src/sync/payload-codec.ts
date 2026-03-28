export interface EncodedSyncPayload {
  contentBase64: string;
  hash: string;
}

export async function encodeSyncPayload(
  data: Uint8Array,
  localHash: string,
  _passphrase: string,
  _rememberValidatedPassphrase: () => Promise<void>,
): Promise<EncodedSyncPayload> {
  return {
    contentBase64: bytesToBase64(data),
    hash: localHash,
  };
}

export async function decodeSyncPayload(
  payloadBase64: string,
  _contentFormat: string,
  _passphrase: string,
  _rememberValidatedPassphrase: () => Promise<void>,
): Promise<Uint8Array> {
  return base64ToBytes(payloadBase64);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

export function bytesToBase64(data: Uint8Array): string {
  let text = "";
  for (const byte of data) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

/**
 * Verifies an Ed25519 signature against a 32-byte public key and message using
 * the Workers Web Crypto API. Inputs are hexadecimal strings.
 */
export async function verifyEd25519Signature(
  publicKeyHex: string,
  signatureHex: string,
  message: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = hexToBytes(publicKeyHex);
    const signatureBytes = hexToBytes(signatureHex);

    // Ed25519 raw public keys are 32 bytes and signatures are 64 bytes.
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
      return false;
    }

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify(
      { name: "Ed25519" },
      cryptoKey,
      signatureBytes,
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    return new Uint8Array(0);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

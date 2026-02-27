import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadEncryptionKey(): Buffer {
  const raw = (process.env.TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is missing");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const parsed = Buffer.from(raw, "base64");
    if (parsed.length === 32) {
      return parsed;
    }
  } catch {
    // Fallback below.
  }

  return createHash("sha256").update(raw).digest();
}

function getKey(): Buffer {
  const key = loadEncryptionKey();
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must resolve to 32 bytes");
  }
  return key;
}

export function encryptSecret(value: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivBase64, authTagBase64, encryptedBase64] = payload.split(".");
  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted payload format");
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

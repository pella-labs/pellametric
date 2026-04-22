import crypto from "node:crypto";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

// AES-256-GCM per-user encryption for prompt text.
// Server holds a master key; per-user DEK (32B) is wrapped with it and stored in user_prompt_key.
// Only the user's own fetch path decrypts — managers never get the ciphertext.

function masterKey(): Buffer {
  const b64 = process.env.PROMPT_MASTER_KEY;
  if (!b64) throw new Error("PROMPT_MASTER_KEY not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("PROMPT_MASTER_KEY must decode to 32 bytes");
  return key;
}

type Packed = { iv: string; tag: string; ciphertext: string };

function encryptGcm(key: Buffer, plaintext: Buffer): Packed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ct.toString("base64") };
}

function decryptGcm(key: Buffer, p: Packed): Buffer {
  const iv = Buffer.from(p.iv, "base64");
  const tag = Buffer.from(p.tag, "base64");
  const ct = Buffer.from(p.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function packWrapped(p: Packed): string {
  return `${p.iv}.${p.tag}.${p.ciphertext}`;
}
function unpackWrapped(s: string): Packed {
  const [iv, tag, ciphertext] = s.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("malformed wrapped key");
  return { iv, tag, ciphertext };
}

// Returns the raw 32-byte DEK for a user, creating + wrapping on first use.
export async function getOrCreateUserDek(userId: string): Promise<Buffer> {
  const mk = masterKey();
  const [row] = await db.select().from(schema.userPromptKey)
    .where(eq(schema.userPromptKey.userId, userId)).limit(1);
  if (row) {
    const p = unpackWrapped(row.keyEnc);
    return decryptGcm(mk, p);
  }
  const dek = crypto.randomBytes(32);
  const wrapped = packWrapped(encryptGcm(mk, dek));
  // Race-safe: ignore conflict; fetch whoever won.
  await db.insert(schema.userPromptKey).values({ userId, keyEnc: wrapped }).onConflictDoNothing();
  const [again] = await db.select().from(schema.userPromptKey)
    .where(eq(schema.userPromptKey.userId, userId)).limit(1);
  return decryptGcm(mk, unpackWrapped(again!.keyEnc));
}

export function encryptPrompt(dek: Buffer, text: string): Packed {
  return encryptGcm(dek, Buffer.from(text, "utf8"));
}

export function decryptPrompt(dek: Buffer, p: Packed): string {
  return decryptGcm(dek, p).toString("utf8");
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Encrypts service API keys at rest (AES-256-GCM). */
export interface Encryptor {
	encrypt(plain: string): string;
	decrypt(payload: string): string;
}

export function createEncryptor(secret: string): Encryptor {
	const key = scryptSync(secret, "cleanarr.v1", 32);
	return {
		encrypt(plain) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
			return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
		},
		decrypt(payload) {
			const [v, iv, tag, ct] = payload.split(":");
			if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported encrypted payload");
			const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
			decipher.setAuthTag(Buffer.from(tag, "base64"));
			return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
		},
	};
}

/** Uses SECRET_KEY when provided, otherwise generates and persists a key in the data dir. */
export function resolveSecret(dataDir: string, configured: string | null): string {
	if (configured) return configured;
	const file = join(dataDir, "secret.key");
	if (existsSync(file)) return readFileSync(file, "utf8").trim();
	const generated = randomBytes(32).toString("hex");
	writeFileSync(file, generated, { mode: 0o600 });
	return generated;
}

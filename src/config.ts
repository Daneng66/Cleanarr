import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
	port: number;
	host: string;
	dataDir: string;
	apiKey: string | null;
	secretKey: string | null;
	logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const dataDir = resolve(env.DATA_DIR ?? "./data");
	mkdirSync(dataDir, { recursive: true });
	return {
		port: Number(env.PORT ?? 8080),
		host: env.HOST ?? "0.0.0.0",
		dataDir,
		apiKey: env.CLEANARR_API_KEY?.trim() || null,
		secretKey: env.SECRET_KEY?.trim() || null,
		logLevel: env.LOG_LEVEL ?? "info",
	};
}

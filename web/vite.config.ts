import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds into dist/web, which the Fastify server serves statically.
export default defineConfig({
	root: __dirname,
	plugins: [react()],
	build: { outDir: "../dist/web", emptyOutDir: true },
	server: { proxy: { "/api": "http://localhost:8080" } },
});

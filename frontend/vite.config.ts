import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.DEVELOPMENT_BACKEND_URL ?? "http://localhost:4100";

export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                // AI HERE: nginx serves .mjs as octet-stream, which kills module scripts. Ceiling: the
                // extension is flattened for every mjs asset, not just the pdf worker. Upgrade path: a
                // types{} entry in the serving config once every host is under our control.
                assetFileNames: (info) => (info.names.some((name) => name.endsWith(".mjs")) ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]"),
            },
        },
    },
    server: {
        host: "0.0.0.0",
        port: 5373,
        allowedHosts: ["host.docker.internal", "localhost"],
        watch: {
            usePolling: true,
        },
        proxy: {
            "/api": {
                target: backend,
                changeOrigin: true,
            },
        },
    },
});

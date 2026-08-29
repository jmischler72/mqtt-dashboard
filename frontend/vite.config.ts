import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Defaults to <root>/node_modules/.vite. The dev container keeps node_modules
  // outside the bind-mounted worktree, so it overrides this (see
  // docker/dev/Dockerfile.dev); everywhere else the default applies.
  cacheDir: process.env.VITE_CACHE_DIR,
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV ?? "production",
    ),
    "process.env": {},
    process: { env: {} },
  },
  server: {
    // Served through the shared dev proxy at http://<worktree>.localhost
    allowedHosts: [".localhost"],
    hmr: {
      clientPort: Number(process.env.VITE_HMR_CLIENT_PORT ?? 5173),
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});

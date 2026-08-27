import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
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

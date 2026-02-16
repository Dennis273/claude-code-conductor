import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/sessions": {
        target: "http://localhost:4577",
        bypass(req) {
          // Let browser page navigations through to SPA; only proxy API calls
          if (req.headers.accept?.includes("text/html")) {
            return "/index.html"
          }
        },
      },
      "/health": "http://localhost:4577",
    },
  },
})

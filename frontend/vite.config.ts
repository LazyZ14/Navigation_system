import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": process.env.VOICE_API_URL || "http://127.0.0.1:8000",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        amap: resolve(__dirname, "amap.html"),
      },
    },
  },
});

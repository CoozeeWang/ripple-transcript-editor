import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import channels from "../desktop/segment-link-config.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), { name: 'segment-channel-manifest', generateBundle() {
    this.emitFile({type:'asset',fileName:'segment-link-channel.json',source:JSON.stringify({channel:process.env.VITE_RIPPLE_RELEASE_TEST === '1' ? 'release-test' : 'production',...channels.production})+'\n'});
  } }],
  server: {
    proxy: {
      "/api": process.env.RIPPLE_API_TARGET || "http://localhost:8000",
    },
  },
});

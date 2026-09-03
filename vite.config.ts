import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
// A static SPA is required for the user's GitHub Pages hosting.
export default defineConfig(({ mode, command }) => ({
  base: process.env.BASE_PATH || "./",
  plugins: [
    react(),
    {
      name: "share-metadata",
      configResolved() {
        if (command === "build" && mode !== "production")
          throw new Error("僅允許 production 建置，測試資料不可部署");
        const env = loadEnv(mode, process.cwd());
        const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
        const key =
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
          env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (command === "build" && (!url || !key))
          throw new Error(
            "正式建置必須設定 Supabase URL 與 publishable key，不提供示範部署",
          );
        if (url || key) {
          if (!url || !key)
            throw new Error("Supabase URL 與 publishable key 必須一起設定");
          if (!url.startsWith("https://") || !key.startsWith("sb_publishable_"))
            throw new Error(
              "僅接受 HTTPS Supabase URL 與 publishable key，禁止使用機密金鑰",
            );
        }
      },
      transformIndexHtml(html) {
        const url =
          loadEnv(mode, process.cwd()).VITE_SITE_URL ||
          process.env.VITE_SITE_URL;
        if (!url) return html;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return html;
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
          return html;
        const escaped = new URL("og.png", parsed).href
          .replaceAll("&", "&amp;")
          .replaceAll('"', "&quot;");
        return html.replace(
          "</head>",
          '<meta property="og:image" content="' +
            escaped +
            '" /><meta name="twitter:image" content="' +
            escaped +
            '" /><meta name="twitter:title" content="2026 TTRA｜主題挑戰賽即時成績" /><meta name="twitter:description" content="查看四大組別最新成績" /></head>',
        );
      },
    },
  ],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { watch: { usePolling: true }, port: 5173, strictPort: true },
}));

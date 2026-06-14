import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function toHttpOrigin(host: string, port: string) {
  const normalizedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const proxyHost = env.PORTA_HOST || process.env.PORTA_HOST || "127.0.0.1";
  const proxyPort = env.PORTA_PORT || process.env.PORTA_PORT || "3170";

  const rawBasePath = env.PORTA_BASE_PATH || process.env.PORTA_BASE_PATH || "/";
  const basePath = rawBasePath.endsWith("/") ? rawBasePath : `${rawBasePath}/`;

  return {
    base: basePath,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          // Only precache hashed static assets — NOT index.html.
          // index.html must always come from the network so deploys
          // take effect immediately. Hashed filenames (e.g. index-Ab12Cd.js)
          // guarantee the SW cache entry matches the code version.
          globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
          skipWaiting: true,
          clientsClaim: true,
          // Don't create a NavigationRoute — let navigation requests
          // hit the network (Cloudflare CDN) for a fresh index.html.
          navigateFallback: null,
        },
        manifest: false, // Use our existing public/manifest.json
        injectRegister: "script-defer",
      }),
    ],
    envDir: repoRoot,
    server: {
      host: env.PORTA_HOST || process.env.PORTA_HOST || "127.0.0.1",
      port: Number(env.PORTA_WEB_PORT || process.env.PORTA_WEB_PORT || 3070),
      allowedHosts: true,
      proxy: {
        [`${basePath}api`]: {
          target: toHttpOrigin(proxyHost, proxyPort),
          changeOrigin: true,
          ws: true,
          rewrite: (path) => {
            const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
            return prefix ? path.replace(new RegExp(`^${prefix}`), "") : path;
          },
          headers: {
            ...(env.CF_ACCESS_CLIENT_ID ? { "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID } : {}),
            ...(env.CF_ACCESS_CLIENT_SECRET ? { "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET } : {}),
          },
        },
      },
    },
  };
});

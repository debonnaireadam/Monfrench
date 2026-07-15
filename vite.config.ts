import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Real Cloudflare deploys (GitHub Actions) override the placeholder bindings
// via CF_* environment variables. When unset, local/Codex dev is unchanged.
const deployD1DatabaseId = process.env.CF_D1_DATABASE_ID;
const deployD1DatabaseName = process.env.CF_D1_DATABASE_NAME;
const deployR2BucketName = process.env.CF_R2_BUCKET_NAME;
const deployWorkerName = process.env.CF_WORKER_NAME;
const deployCustomDomain = process.env.CF_CUSTOM_DOMAIN;
const isRealDeploy = Boolean(deployD1DatabaseId);

const localBindingConfig = {
  ...(deployWorkerName ? { name: deployWorkerName } : {}),
  ...(isRealDeploy ? { compatibility_date: "2025-12-01" } : {}),
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // The worker's /_vinext/image endpoint needs the Images binding in
  // production; Codex hosting injects it, a real deploy declares it here.
  ...(isRealDeploy ? { images: { binding: "IMAGES" } } : {}),
  ...(deployCustomDomain
    ? { routes: [{ pattern: deployCustomDomain, custom_domain: true }] }
    : {}),
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: deployD1DatabaseName ?? "site-creator-d1",
          database_id: deployD1DatabaseId ?? SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: deployR2BucketName ?? "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});

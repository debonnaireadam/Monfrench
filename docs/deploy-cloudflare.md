# Deploying MonFrench to your own Cloudflare account

The site is a Cloudflare Worker (built with vinext/Vite) plus a D1 database
(`DB` binding) and an R2 bucket (`FILES` binding). Originally it was published
through Codex app hosting; this repo now carries its own pipeline so pushing to
`main` deploys directly to a personal Cloudflare account — no Codex involved.

## How it works

`.github/workflows/deploy.yml` runs on every push to `main`:

1. `npm ci`, then `npm test` (which builds the site).
2. Creates the D1 database (`monfrench-db`) and R2 bucket (`monfrench-files`)
   on first run if they don't exist yet.
3. Applies pending D1 migrations from `drizzle/`.
4. `wrangler deploy` publishes the Worker (named `monfrench`).

If the Cloudflare secrets are missing, the workflow still builds and tests but
skips the deploy, so CI stays green before setup is complete.

`vite.config.ts` reads `CF_D1_DATABASE_ID`, `CF_D1_DATABASE_NAME`,
`CF_R2_BUCKET_NAME`, `CF_WORKER_NAME`, and `CF_CUSTOM_DOMAIN` from the
environment at build time. Locally (and in Codex) they're unset and the
placeholder bindings are used, same as before.

## One-time setup

1. **Cloudflare account** — free plan is fine, but R2 requires a payment
   method on file (the free allowance is generous; a small site costs $0).
2. **API token** — dash.cloudflare.com → My Profile → API Tokens → Create
   Token. Start from the "Edit Cloudflare Workers" template and add:
   - Account → D1 → Edit
   - Account → Workers R2 Storage → Edit
   - (later, for the custom domain) Zone → Workers Routes → Edit on the zone
3. **GitHub secrets** — in the repo settings (or via `gh`):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN --repo debonnaireadam/Monfrench
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo debonnaireadam/Monfrench
   ```

   The account ID is on the right side of any zone page, or under Workers &
   Pages → Overview.
4. **Runtime secrets on the Worker** (after the first successful deploy):

   ```sh
   npx wrangler secret put PASSWORD_PEPPER      # required — login fails without it
   npx wrangler secret put TEACHER_SETUP_CODE   # code for creating the first teacher account
   npx wrangler secret put TURNSTILE_SITE_KEY   # optional — login CAPTCHA
   npx wrangler secret put TURNSTILE_SECRET_KEY # optional
   ```

   Turnstile keys come from dash.cloudflare.com → Turnstile → Add widget
   (domain: monfrench.com).

## Pointing monfrench.com at the Worker

1. Add the `monfrench.com` zone to the Cloudflare account (Websites → Add a
   domain) and switch the registrar's nameservers to the ones Cloudflare
   assigns — or, if the domain is already on this Cloudflare account, skip.
2. Set a repo **variable** (not secret) `CF_CUSTOM_DOMAIN` = `monfrench.com`.
3. Re-run the deploy. Wrangler attaches the custom domain to the Worker.

Until then, the site is reachable at `monfrench.<subdomain>.workers.dev`.

## Migrating data off Codex hosting

The old D1 database and R2 files live inside the Codex project
(`.openai/hosting.json`), which Cloudflare tooling can't reach. If anything
there needs to be preserved (accounts, uploaded activities, submissions), the
export has to happen through Codex one last time (e.g. ask it to dump the D1
tables to SQL and list/download R2 objects). Otherwise, start fresh: the first
visitor to the new deployment gets the teacher-setup flow, gated by
`TEACHER_SETUP_CODE`.

Note: password hashes depend on `PASSWORD_PEPPER`, a Codex-side secret. Unless
that value is recovered too, migrated accounts would need password resets.

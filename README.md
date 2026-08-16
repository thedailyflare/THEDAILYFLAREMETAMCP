# The Daily Flare Meta Ads MCP

An OAuth-enabled Model Context Protocol server for The Daily Flare's Facebook/Meta advertising workflows, built on the MCP TypeScript SDK v2 and Streamable HTTP.

## Production target

The intended public endpoint is:

`https://thedailyflare.com/meta-mcp/mcp`

The repository is also Vercel-ready. Vercel's Express/MCP deployment model supports an Express MCP server behind a `/mcp` route, and the project adds a `/meta-mcp/*` rewrite so the public path can coexist with the existing site when the domain is routed through Vercel. citeturn0search1turn0search3

## Capabilities

### Meta Ads

- Test Meta connection and identify the connected user
- Discover advertising accounts and detailed account status
- Campaign list/create/update/delete
- Ad set list/create/update/delete
- Ad list/create/update/delete using existing creatives
- Creative discovery
- Generic object insights
- Campaign-level, ad-set-level and ad-level insights
- Custom audience list/create

### Facebook Pages

- List accessible Pages
- Read recent Page posts
- Read Page performance insights

### Safety defaults

New campaigns and ad sets default to `PAUSED`; ads also default to `PAUSED` where a status is supplied. Page access tokens are never returned by the `get_pages` tool.

## Authentication

The server provides an OAuth authorization layer for MCP clients and then performs Meta OAuth authorization. MCP access tokens are random opaque tokens. Meta credentials are encrypted at rest with AES-256-GCM.

For serverless deployment, OAuth clients, temporary authorization state, one-time codes and MCP tokens use Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured. This is required on Vercel because normal function filesystems are not durable across invocations. citeturn0search0turn3search1

## Meta app configuration

In the Meta Developer App, configure the relevant Facebook Login product and add this exact OAuth redirect URI:

`https://thedailyflare.com/meta-mcp/oauth/meta/callback`

The app needs the permissions required by the ad operations you intend to use, normally `ads_management`, `ads_read`, and `business_management`. Meta may require App Review or appropriate roles/access for production use.

## Environment

Required production variables:

- `PUBLIC_BASE_URL=https://thedailyflare.com/meta-mcp`
- `BASE_PATH=` (empty when Vercel rewrites `/meta-mcp/*` to the function)
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI=https://thedailyflare.com/meta-mcp/oauth/meta/callback`
- `MCP_TOKEN_SECRET` — long, random encryption secret
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `REDIS_KEY_PREFIX=tdf:meta-mcp:`

Optional:

- `META_API_VERSION` — defaults to `v25.0`
- `META_SCOPES` — comma-separated Meta permissions

Never commit `.env`, Meta secrets, Redis tokens, or `data/auth.json`.

## Vercel

The repository contains:

- `api/index.ts` — Vercel serverless entrypoint
- `vercel.json` — `/meta-mcp/*` routing and Node.js 22 function configuration
- durable Redis-backed OAuth storage

Vercel's own MCP templates use serverless functions and expose MCP through a `/mcp` path. Fluid Compute is recommended for MCP workloads. citeturn0search2turn0search3

Because `thedailyflare.com` already serves the WordPress site, the final DNS/routing arrangement must preserve the existing site while sending only `/meta-mcp/*` to the Vercel project. Vercel supports reverse-proxy/rewrite patterns for serving an application on a subpath, but the primary domain routing must be configured at the domain's current edge/DNS layer. citeturn2search2turn2search0

## Run locally / on a normal Node host

```bash
npm install
npm run typecheck
npm start
```

Health check: `/health`

MCP endpoint: `/mcp`

OAuth metadata:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

## Security

- Production refuses to start without HTTPS and required secrets.
- MCP credentials are opaque and stored by hash.
- Meta credentials are encrypted before storage.
- OAuth authorization codes expire after five minutes and are single-use.
- OAuth state expires after ten minutes and is single-use.
- PKCE S256 is required.
- Redirect URIs are validated against the dynamically registered client.
- Meta App Secret is never returned to MCP clients.
- Page access tokens are never exposed by the Page discovery tool.

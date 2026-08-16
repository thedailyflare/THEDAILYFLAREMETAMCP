# The Daily Flare Meta Ads MCP

An OAuth-enabled Model Context Protocol server for The Daily Flare's Facebook/Meta advertising workflows.

## What it exposes

- Connection and account discovery
- Campaign list/create/update/delete
- Ad set list/create/update/delete
- Ad list/create/update/delete using an existing creative
- Ad insights
- Custom audience list/create
- Facebook Page list, posts and Page insights

All ad mutations default to `PAUSED` where Meta supports a status field, so an AI tool call does not accidentally publish a new campaign immediately.

## Authentication

This server implements an MCP OAuth authorization flow and then connects the user to Meta's OAuth flow. Meta access tokens are encrypted at rest with AES-256-GCM. MCP bearer tokens are stored as SHA-256 hashes.

### Meta app configuration

In the Meta Developer App, configure Facebook Login and add this exact OAuth redirect URI:

`https://YOUR-MCP-DOMAIN/oauth/meta/callback`

The app needs the permissions required by the ad operations you intend to use, normally `ads_management`, `ads_read`, and `business_management`. Meta may require App Review or appropriate roles/access for production use.

### Environment

Copy `.env.example` to `.env` and set:

- `PUBLIC_BASE_URL` — the public HTTPS URL of this server
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI`
- `MCP_TOKEN_SECRET` — long random secret used to encrypt stored Meta credentials
- `META_API_VERSION` — defaults to `v25.0`

Never commit `.env` or `data/auth.json`.

## Run

```bash
npm install
npm run typecheck
npm start
```

Health check: `/health`

MCP endpoint: `/mcp`

OAuth metadata: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`

## Connecting an MCP client

Point the client at the MCP endpoint:

`https://YOUR-MCP-DOMAIN/mcp`

The client should discover the OAuth metadata, register dynamically, open the authorization URL, complete Meta login/consent, and exchange the returned authorization code using PKCE S256.

## Security notes

- Use HTTPS in production.
- Keep `META_APP_SECRET` and `MCP_TOKEN_SECRET` out of Git.
- Do not expose the service publicly without OAuth configured.
- Meta access is user-scoped; the connected user must actually have access to the ad accounts being managed.

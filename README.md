# The Daily Flare Meta Ads MCP

An OAuth-enabled Model Context Protocol server for The Daily Flare's Facebook/Meta advertising workflows, built on the stable MCP TypeScript SDK v2 and Streamable HTTP.

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

New campaigns, ad sets and ads default to `PAUSED` unless a caller explicitly supplies another status. Page access tokens are never returned by the `get_pages` tool.

## Authentication

The server provides an OAuth authorization layer for MCP clients and then performs the Meta OAuth authorization. MCP access tokens are random opaque tokens whose hashes are stored on disk. Meta credentials are encrypted at rest with AES-256-GCM.

The MCP endpoint accepts bearer authentication and passes validated auth context into the MCP server. Remote MCP deployments should use HTTPS.

### Meta app configuration

In the Meta Developer App, configure Facebook Login and add this exact OAuth redirect URI:

`https://YOUR-MCP-DOMAIN/oauth/meta/callback`

The app needs the permissions required by the ad operations you intend to use, normally `ads_management`, `ads_read`, and `business_management`. Meta may require App Review or appropriate roles/access for production use.

### Environment

Copy `.env.example` to `.env` and set:

- `PUBLIC_BASE_URL` — public HTTPS URL of this server in production
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI`
- `MCP_TOKEN_SECRET` — long random secret used to encrypt stored Meta credentials
- `META_API_VERSION` — defaults to `v25.0`
- `META_SCOPES` — optional comma-separated Meta permissions

Production startup refuses to run without the required secrets and HTTPS configuration.

Never commit `.env` or `data/auth.json`.

## Run

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

## Connecting an MCP client

Point the client at:

`https://YOUR-MCP-DOMAIN/mcp`

The client can discover the OAuth metadata, register, complete the Meta authorization flow, and exchange the authorization code using PKCE S256.

## Deployment

A production Dockerfile is included. Persist `/app/data` across restarts because it contains the encrypted credential store. Inject secrets through the hosting provider rather than committing them to the repository.

## Development

GitHub Actions runs the TypeScript typecheck on pushes to `main` and pull requests. The MCP dependencies are pinned to the stable `2.0.0` release rather than `latest` for reproducible deployments.

## Security notes

- Use HTTPS in production.
- Keep `META_APP_SECRET` and `MCP_TOKEN_SECRET` out of Git.
- Use a strong, unique `MCP_TOKEN_SECRET`.
- Persist `/app/data` securely and restrict filesystem access.
- Meta access is user-scoped; the connected user must actually have access to the ad accounts being managed.

import 'dotenv/config';
import express from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { randomBytes } from 'node:crypto';
import { AuthStore } from './auth.js';
import { createMetaAdsServer } from './mcp.js';
import { exchangeCodeForLongLivedToken, getAuthenticatedUser } from './meta.js';

const app = express();
const store = new AuthStore();
const port = Number(process.env.PORT || 3000);
const apiVersion = process.env.META_API_VERSION || 'v25.0';
const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const metaRedirectUri = process.env.META_OAUTH_REDIRECT_URI || `${baseUrl}/oauth/meta/callback`;
const metaScopes = (process.env.META_SCOPES || 'ads_management,ads_read,business_management').split(',').map(s => s.trim()).filter(Boolean);

if (process.env.NODE_ENV === 'production') {
  for (const name of ['PUBLIC_BASE_URL', 'META_APP_ID', 'META_APP_SECRET', 'META_OAUTH_REDIRECT_URI', 'MCP_TOKEN_SECRET']) {
    if (!process.env[name]) throw new Error(`Missing required production environment variable: ${name}`);
  }
  if (!baseUrl.startsWith('https://')) throw new Error('PUBLIC_BASE_URL must use HTTPS in production.');
  if (!metaRedirectUri.startsWith('https://')) throw new Error('META_OAUTH_REDIRECT_URI must use HTTPS in production.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

function oauthError(res: express.Response, status: number, message: string) { res.status(status).json({ error: message }); }
function isAllowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(u.hostname));
  } catch { return false; }
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'thedailyflare-meta-ads-mcp', api_version: apiVersion }));

app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({
  resource: `${baseUrl}/mcp`,
  authorization_servers: [baseUrl],
  scopes_supported: ['mcp']
}));

app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/oauth/authorize`,
  token_endpoint: `${baseUrl}/oauth/token`,
  registration_endpoint: `${baseUrl}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none']
}));

app.post('/oauth/register', async (req, res) => {
  const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
  if (!redirectUris.length || redirectUris.some((u: string) => !isAllowedRedirect(u))) return oauthError(res, 400, 'redirect_uris must contain valid HTTPS or localhost URLs');
  const clientId = await store.registerClient(redirectUris, req.body?.client_name ? String(req.body.client_name) : undefined);
  res.status(201).json({ client_id: clientId, client_name: req.body?.client_name || 'MCP client', redirect_uris: redirectUris, token_endpoint_auth_method: 'none' });
});

app.get('/oauth/authorize', async (req, res) => {
  const clientId = String(req.query.client_id || '');
  const redirectUri = String(req.query.redirect_uri || '');
  const state = String(req.query.state || '');
  const challenge = String(req.query.code_challenge || '');
  const method = String(req.query.code_challenge_method || '');
  if (String(req.query.response_type || '') !== 'code' || !clientId || !redirectUri || !challenge || method !== 'S256') return oauthError(res, 400, 'Invalid authorization request');
  const client = await store.getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) return oauthError(res, 400, 'Unknown client or redirect URI');

  const oauthState = randomBytes(24).toString('base64url');
  pendingStates.set(oauthState, { clientId, redirectUri, state, challenge });
  const url = new URL(`https://www.facebook.com/${apiVersion}/dialog/oauth`);
  url.searchParams.set('client_id', process.env.META_APP_ID || '');
  url.searchParams.set('redirect_uri', metaRedirectUri);
  url.searchParams.set('state', oauthState);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', metaScopes.join(','));
  res.redirect(url.toString());
});

type Pending = { clientId: string; redirectUri: string; state: string; challenge: string };
const pendingStates = new Map<string, Pending>();
setInterval(() => { if (pendingStates.size > 5000) pendingStates.clear(); }, 60_000).unref();

app.get('/oauth/meta/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending) return res.status(400).send('OAuth state expired or invalid. Start the connection again.');
  if (req.query.error) {
    const u = new URL(pending.redirectUri); u.searchParams.set('error', String(req.query.error)); u.searchParams.set('state', pending.state); return res.redirect(u.toString());
  }
  try {
    const token = await exchangeCodeForLongLivedToken(String(req.query.code || ''), metaRedirectUri);
    const user = await getAuthenticatedUser(token.access_token);
    const meta = { metaAccessToken: token.access_token, metaUserId: user.id, metaUserName: user.name, expiresAt: token.expires_in ? Math.floor(Date.now() / 1000) + token.expires_in : undefined };
    const code = await store.createCode({ clientId: pending.clientId, redirectUri: pending.redirectUri, codeChallenge: pending.challenge, meta });
    const u = new URL(pending.redirectUri); u.searchParams.set('code', code); u.searchParams.set('state', pending.state); res.redirect(u.toString());
  } catch (error) {
    console.error('[Meta OAuth]', error);
    const u = new URL(pending.redirectUri); u.searchParams.set('error', 'access_denied'); u.searchParams.set('error_description', 'Meta authorization could not be completed.'); u.searchParams.set('state', pending.state); res.redirect(u.toString());
  }
});

app.post('/oauth/token', async (req, res) => {
  if (req.body?.grant_type !== 'authorization_code') return oauthError(res, 400, 'Unsupported grant_type');
  const clientId = String(req.body?.client_id || '');
  const redirectUri = String(req.body?.redirect_uri || '');
  const verifier = String(req.body?.code_verifier || '');
  const code = String(req.body?.code || '');
  const client = await store.getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri) || !verifier || !code) return oauthError(res, 400, 'Invalid token request');
  const redeemed = await store.redeemCode(code, verifier);
  if (!redeemed || redeemed.clientId !== clientId || redeemed.redirectUri !== redirectUri) return oauthError(res, 400, 'Invalid or expired authorization code');
  const accessToken = await store.createAccessToken(redeemed.meta);
  res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 60 * 60 * 24 * 30, scope: 'mcp' });
});

async function verifyBearer(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) return null;
  return store.verifyAccessToken(header.slice(7).trim());
}

const mcpHandler = createMcpHandler((ctx) => createMetaAdsServer(ctx));
const mcpNodeHandler = toNodeHandler(mcpHandler, { onerror: (error) => console.error('[MCP]', error) });

app.all('/mcp', async (req, res) => {
  const meta = await verifyBearer(req.headers.authorization);
  if (!meta) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'unauthorized', error_description: 'Connect this MCP server through OAuth first.' });
  }
  (req as any).auth = { token: 'mcp', clientId: meta.metaUserId, scopes: ['mcp'], expiresAt: meta.expiresAt || Math.floor(Date.now() / 1000) + 3600, extra: { metaAccessToken: meta.metaAccessToken, metaUserId: meta.metaUserId, metaUserName: meta.metaUserName } };
  return mcpNodeHandler(req, res, req.body);
});

app.listen(port, () => console.error(`The Daily Flare Meta Ads MCP listening on ${baseUrl}`));

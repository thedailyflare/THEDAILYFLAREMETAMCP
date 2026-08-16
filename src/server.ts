import "dotenv/config";
import express from "express";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { randomBytes } from "node:crypto";
import { AuthStore, type MetaCredential } from "./auth.js";
import { registerTools } from "./mcp.js";
import { exchangeCodeForLongLivedToken, getAuthenticatedUser } from "./meta.js";

const app = express();
const store = new AuthStore();
const port = Number(process.env.PORT || 3000);
const apiVersion = process.env.META_API_VERSION || "v25.0";
const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const basePath = (process.env.BASE_PATH || "/meta-mcp").replace(/\/+$/, "") || "";
const metaRedirectUri = process.env.META_OAUTH_REDIRECT_URI || `${baseUrl}${basePath}/oauth/meta/callback`;
const metaScopes = (process.env.META_SCOPES || "ads_management,ads_read,business_management").split(",").map(s => s.trim()).filter(Boolean);
const route = (p: string) => `${basePath}${p}`;

if (process.env.NODE_ENV === "production") {
  for (const name of ["PUBLIC_BASE_URL", "META_APP_ID", "META_APP_SECRET", "META_OAUTH_REDIRECT_URI", "MCP_TOKEN_SECRET"]) if (!process.env[name]) throw new Error(`Missing required production environment variable: ${name}`);
  if (!baseUrl.startsWith("https://") || !metaRedirectUri.startsWith("https://")) throw new Error("Production URLs must use HTTPS.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

function oauthError(res: express.Response, status: number, message: string) { return res.status(status).json({ error: message }); }
function isAllowedRedirect(uri: string) {
  try { const u = new URL(uri); return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(u.hostname)); } catch { return false; }
}

app.get(route("/health"), (_req, res) => res.json({ ok: true, service: "thedailyflare-meta-ads-mcp", endpoint: `${baseUrl}${route("/mcp")}`, api_version: apiVersion }));
app.get(route("/.well-known/oauth-protected-resource"), (_req, res) => res.json({ resource: `${baseUrl}${route("/mcp")}`, authorization_servers: [baseUrl + basePath], scopes_supported: ["mcp"] }));
app.get(route("/.well-known/oauth-authorization-server"), (_req, res) => res.json({ issuer: baseUrl + basePath, authorization_endpoint: baseUrl + route("/oauth/authorize"), token_endpoint: baseUrl + route("/oauth/token"), registration_endpoint: baseUrl + route("/oauth/register"), response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] }));

const pendingStates = new Map<string, { clientId: string; redirectUri: string; state: string; challenge: string }>();
setInterval(() => { if (pendingStates.size > 5000) pendingStates.clear(); }, 60_000).unref();

app.post(route("/oauth/register"), async (req, res) => {
  const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
  if (!redirectUris.length || redirectUris.some((u: string) => !isAllowedRedirect(u))) return oauthError(res, 400, "redirect_uris must contain valid HTTPS or localhost URLs");
  const clientId = await store.registerClient(redirectUris, req.body?.client_name ? String(req.body.client_name) : undefined);
  return res.status(201).json({ client_id: clientId, client_name: req.body?.client_name || "MCP client", redirect_uris: redirectUris, token_endpoint_auth_method: "none" });
});

app.get(route("/oauth/authorize"), async (req, res) => {
  const clientId = String(req.query.client_id || ""), redirectUri = String(req.query.redirect_uri || ""), state = String(req.query.state || ""), challenge = String(req.query.code_challenge || "");
  if (String(req.query.response_type || "") !== "code" || !clientId || !redirectUri || !challenge || String(req.query.code_challenge_method || "") !== "S256") return oauthError(res, 400, "Invalid OAuth authorization request");
  const client = await store.getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) return oauthError(res, 400, "Unknown client or redirect URI");
  const oauthState = randomBytes(24).toString("base64url");
  pendingStates.set(oauthState, { clientId, redirectUri, state, challenge });
  const url = new URL(`https://www.facebook.com/${apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", process.env.META_APP_ID || "");
  url.searchParams.set("redirect_uri", metaRedirectUri);
  url.searchParams.set("state", oauthState);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", metaScopes.join(","));
  return res.redirect(url.toString());
});

app.get(route("/oauth/meta/callback"), async (req, res) => {
  const state = String(req.query.state || "");
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending) return res.status(400).send("OAuth state expired or invalid. Start the connection again.");
  if (req.query.error) { const u = new URL(pending.redirectUri); u.searchParams.set("error", String(req.query.error)); u.searchParams.set("state", pending.state); return res.redirect(u.toString()); }
  try {
    const token = await exchangeCodeForLongLivedToken(String(req.query.code || ""), metaRedirectUri);
    const user = await getAuthenticatedUser(token.access_token);
    const meta: MetaCredential = { metaAccessToken: token.access_token, metaUserId: user.id, metaUserName: user.name, expiresAt: Math.floor(Date.now() / 1000) + (token.expires_in || 60 * 24 * 60 * 60) };
    const code = await store.createCode({ clientId: pending.clientId, redirectUri: pending.redirectUri, codeChallenge: pending.challenge, meta });
    const u = new URL(pending.redirectUri); u.searchParams.set("code", code); u.searchParams.set("state", pending.state); return res.redirect(u.toString());
  } catch (error) {
    console.error("[Meta OAuth]", error);
    const u = new URL(pending.redirectUri); u.searchParams.set("error", "access_denied"); u.searchParams.set("error_description", "Meta authorization could not be completed."); u.searchParams.set("state", pending.state); return res.redirect(u.toString());
  }
});

app.post(route("/oauth/token"), async (req, res) => {
  if (req.body?.grant_type !== "authorization_code") return oauthError(res, 400, "Unsupported grant_type");
  const clientId = String(req.body?.client_id || ""), redirectUri = String(req.body?.redirect_uri || ""), verifier = String(req.body?.code_verifier || ""), code = String(req.body?.code || "");
  const client = await store.getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri) || !verifier || !code) return oauthError(res, 400, "Invalid token request");
  const redeemed = await store.redeemCode(code, verifier);
  if (!redeemed || redeemed.clientId !== clientId || redeemed.redirectUri !== redirectUri) return oauthError(res, 400, "Invalid or expired authorization code");
  const accessToken = await store.createAccessToken(redeemed.meta);
  return res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 60 * 60 * 24 * 30, scope: "mcp" });
});

async function verifyBearer(header?: string) { if (!header?.startsWith("Bearer ")) return null; return store.verifyAccessToken(header.slice(7).trim()); }

const mcpHandler = createMcpHandler(ctx => {
  const meta = ctx.authInfo?.extra?.metaAccessToken;
  const server = new McpServer({ name: "thedailyflare-meta-ads", version: "1.2.0", title: "The Daily Flare Meta Ads MCP", description: "Meta advertising management and analytics for The Daily Flare." });
  registerTools(server, () => { if (!meta) throw new Error("Meta account is not connected."); return String(meta); });
  return server;
});
const mcpNodeHandler = toNodeHandler(mcpHandler, { onerror: error => console.error("[MCP]", error) });

app.all(route("/mcp"), async (req, res) => {
  const meta = await verifyBearer(req.headers.authorization);
  if (!meta) { res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${baseUrl}${route("/.well-known/oauth-protected-resource")}"`); return res.status(401).json({ error: "unauthorized", error_description: "Connect this MCP server through OAuth first." }); }
  // The Node adapter forwards raw-request auth to ctx.http.authInfo.
  (req as any).auth = { token: "mcp", clientId: meta.metaUserId, scopes: ["mcp"], expiresAt: meta.expiresAt, extra: { metaAccessToken: meta.metaAccessToken, metaUserId: meta.metaUserId, metaUserName: meta.metaUserName } };
  return mcpNodeHandler(req, res, req.body);
});

app.listen(port, "0.0.0.0", () => console.log(`The Daily Flare Meta Ads MCP listening on ${baseUrl}${basePath}`));

const API_VERSION = process.env.META_API_VERSION || 'v25.0';
const APP_ID = process.env.META_APP_ID || '';
const APP_SECRET = process.env.META_APP_SECRET || '';

export class MetaApiError extends Error {
  constructor(public status: number, public code: number | undefined, public type: string | undefined, message: string) {
    super(message);
    this.name = 'MetaApiError';
  }
}

function appSecretProof(accessToken: string) {
  if (!APP_SECRET) return undefined;
  return BunLikeHmac(APP_SECRET, accessToken);
}

function BunLikeHmac(secret: string, value: string) {
  return createHmacSha256(secret, value);
}

function createHmacSha256(secret: string, value: string) {
  // Node's Web Crypto keeps this module dependency-free.
  // The synchronous helper below is replaced at runtime by crypto.createHmac.
  return requireCrypto().createHmac('sha256', secret).update(value).digest('hex');
}

function requireCrypto() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:crypto') as typeof import('node:crypto');
}

export async function metaRequest<T = unknown>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${path.replace(/^\//, '')}`);
  const proof = appSecretProof(accessToken);
  url.searchParams.set('access_token', accessToken);
  if (proof) url.searchParams.set('appsecret_proof', proof);

  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const error = body?.error || {};
    throw new MetaApiError(response.status, error.code, error.type, error.message || `Meta API request failed (${response.status})`);
  }
  return body as T;
}

export async function exchangeCodeForLongLivedToken(code: string, redirectUri: string) {
  const shortUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
  shortUrl.searchParams.set('client_id', APP_ID);
  shortUrl.searchParams.set('client_secret', APP_SECRET);
  shortUrl.searchParams.set('redirect_uri', redirectUri);
  shortUrl.searchParams.set('code', code);

  const shortResponse = await fetch(shortUrl);
  const shortBody = await shortResponse.json();
  if (!shortResponse.ok || shortBody?.error) throw new MetaApiError(shortResponse.status, shortBody?.error?.code, shortBody?.error?.type, shortBody?.error?.message || 'OAuth code exchange failed');

  const longUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', APP_ID);
  longUrl.searchParams.set('client_secret', APP_SECRET);
  longUrl.searchParams.set('fb_exchange_token', shortBody.access_token);
  const longResponse = await fetch(longUrl);
  const longBody = await longResponse.json();
  if (!longResponse.ok || longBody?.error) throw new MetaApiError(longResponse.status, longBody?.error?.code, longBody?.error?.type, longBody?.error?.message || 'Long-lived token exchange failed');
  return longBody as { access_token: string; token_type?: string; expires_in?: number };
}

export async function getAuthenticatedUser(accessToken: string) {
  return metaRequest<{ id: string; name?: string }>(accessToken, 'me?fields=id,name');
}

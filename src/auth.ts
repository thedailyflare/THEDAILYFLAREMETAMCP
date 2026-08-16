import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";

type RecordData = { metaAccessToken: string; metaUserId: string; metaUserName?: string; expiresAt?: number };
type Db = { records: Record<string, string>; codes: Record<string, CodeData>; clients: Record<string, ClientData> };
type CodeData = { clientId: string; redirectUri: string; codeChallenge: string; meta: RecordData; expiresAt: number };
type ClientData = { redirectUris: string[]; clientName?: string };
type OAuthState = { clientId: string; redirectUri: string; state: string; challenge: string };

const FILE = process.env.DATA_FILE || "./data/auth.json";
const SECRET = process.env.MCP_TOKEN_SECRET;
if (!SECRET) throw new Error("MCP_TOKEN_SECRET is required.");
const key = createHash("sha256").update(SECRET).digest();
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const prefix = process.env.REDIS_KEY_PREFIX || "tdf:meta-mcp:";

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}
function decrypt(value: string) {
  const [iv, ciphertext, tag] = value.split(".").map(x => Buffer.from(x, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
const k = (kind: string, id: string) => `${prefix}${kind}:${id}`;

export class AuthStore {
  private db: Db = { records: {}, codes: {}, clients: {} };
  private loaded = false;

  private async load() {
    if (redis || this.loaded) return;
    try { this.db = JSON.parse(await readFile(FILE, "utf8")) as Db; } catch {}
    this.loaded = true;
  }
  private async save() {
    if (redis) return;
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(this.db, null, 2), { mode: 0o600 });
  }

  async registerClient(redirectUris: string[], clientName?: string) {
    const id = `tdf_${randomBytes(18).toString("base64url")}`;
    const value = { redirectUris, clientName };
    if (redis) await redis.set(k("client", id), value);
    else { await this.load(); this.db.clients[id] = value; await this.save(); }
    return id;
  }

  async getClient(clientId: string) {
    if (redis) return await redis.get<ClientData>(k("client", clientId));
    await this.load(); return this.db.clients[clientId] || null;
  }

  async createOAuthState(data: OAuthState) {
    const id = randomBytes(24).toString("base64url");
    if (redis) await redis.set(k("state", id), data, { ex: 600 });
    else { await this.load(); this.db.records[`state:${id}`] = encrypt(JSON.stringify(data)); await this.save(); }
    return id;
  }

  async consumeOAuthState(id: string) {
    let value: OAuthState | null = null;
    if (redis) value = await redis.getdel<OAuthState>(k("state", id));
    else { await this.load(); const raw = this.db.records[`state:${id}`]; delete this.db.records[`state:${id}`]; await this.save(); if (raw) { try { value = JSON.parse(decrypt(raw)); } catch {} } }
    return value;
  }

  async createCode(data: Omit<CodeData, "expiresAt">) {
    const code = randomBytes(32).toString("base64url");
    const item = { ...data, expiresAt: Math.floor(Date.now() / 1000) + 300 };
    if (redis) await redis.set(k("code", hash(code)), encrypt(JSON.stringify(item)), { ex: 300 });
    else { await this.load(); this.db.codes[hash(code)] = item; await this.save(); }
    return code;
  }

  async redeemCode(code: string, verifier: string) {
    let item: CodeData | null = null;
    if (redis) {
      const raw = await redis.getdel<string>(k("code", hash(code)));
      if (raw) { try { item = JSON.parse(decrypt(raw)); } catch {} }
    } else {
      await this.load(); item = this.db.codes[hash(code)] || null; delete this.db.codes[hash(code)]; await this.save();
    }
    if (!item || item.expiresAt < Math.floor(Date.now() / 1000)) return null;
    const expected = createHash("sha256").update(verifier).digest("base64url");
    const a = Buffer.from(expected), b = Buffer.from(item.codeChallenge);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return item;
  }

  async createAccessToken(meta: RecordData) {
    const token = randomBytes(32).toString("base64url");
    const ttl = Math.max(60, meta.expiresAt - Math.floor(Date.now() / 1000));
    const value = encrypt(JSON.stringify(meta));
    if (redis) await redis.set(k("token", hash(token)), value, { ex: ttl });
    else { await this.load(); this.db.records[`token:${hash(token)}`] = value; await this.save(); }
    return token;
  }

  async verifyAccessToken(token: string) {
    const raw = redis
      ? await redis.get<string>(k("token", hash(token)))
      : await this.getLocalToken(token);
    if (!raw) return null;
    try {
      const meta = JSON.parse(decrypt(raw)) as RecordData;
      if (meta.expiresAt && meta.expiresAt <= Math.floor(Date.now() / 1000)) return null;
      return meta;
    } catch { return null; }
  }

  private async getLocalToken(token: string) {
    await this.load(); return this.db.records[`token:${hash(token)}`] || null;
  }
}

export const authStorage = redis ? "upstash-redis" : "local-file";

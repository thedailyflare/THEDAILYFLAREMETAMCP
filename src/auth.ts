import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type RecordData = { metaAccessToken: string; metaUserId: string; metaUserName?: string; expiresAt?: number };
type Db = { records: Record<string, string>; codes: Record<string, CodeData>; clients: Record<string, ClientData> };
type CodeData = { clientId: string; redirectUri: string; codeChallenge: string; meta: RecordData; expiresAt: number };
type ClientData = { redirectUris: string[]; clientName?: string };

const FILE = process.env.DATA_FILE || './data/auth.json';
const SECRET = process.env.MCP_TOKEN_SECRET || 'development-only-change-me';
const key = createHash('sha256').update(SECRET).digest();

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}
function decrypt(value: string) {
  const [iv, ciphertext, tag] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }

export class AuthStore {
  private db: Db = { records: {}, codes: {}, clients: {} };
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    try { this.db = JSON.parse(await readFile(FILE, 'utf8')) as Db; } catch { /* first run */ }
    this.loaded = true;
  }
  private async save() {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(this.db, null, 2), { mode: 0o600 });
  }

  async saveMeta(meta: RecordData) {
    await this.load();
    const id = randomBytes(18).toString('base64url');
    this.db.records[id] = encrypt(JSON.stringify(meta));
    await this.save();
    return id;
  }

  async createAccessToken(meta: RecordData) {
    await this.load();
    const token = randomBytes(32).toString('base64url');
    this.db.records[`token:${hash(token)}`] = encrypt(JSON.stringify(meta));
    await this.save();
    return token;
  }

  async verifyAccessToken(token: string) {
    await this.load();
    const raw = this.db.records[`token:${hash(token)}`];
    if (!raw) return null;
    try {
      const meta = JSON.parse(decrypt(raw)) as RecordData;
      if (meta.expiresAt && meta.expiresAt < Math.floor(Date.now() / 1000)) return null;
      return meta;
    } catch { return null; }
  }

  async registerClient(redirectUris: string[], clientName?: string) {
    await this.load();
    const clientId = `tdf_${randomBytes(18).toString('base64url')}`;
    this.db.clients[clientId] = { redirectUris, clientName };
    await this.save();
    return clientId;
  }

  async getClient(clientId: string) { await this.load(); return this.db.clients[clientId] || null; }

  async createCode(data: Omit<CodeData, 'expiresAt'>) {
    await this.load();
    const code = randomBytes(32).toString('base64url');
    this.db.codes[hash(code)] = { ...data, expiresAt: Math.floor(Date.now() / 1000) + 300 };
    await this.save();
    return code;
  }

  async redeemCode(code: string, verifier: string) {
    await this.load();
    const keyName = hash(code);
    const item = this.db.codes[keyName];
    delete this.db.codes[keyName];
    await this.save();
    if (!item || item.expiresAt < Math.floor(Date.now() / 1000)) return null;
    const expected = createHash('sha256').update(verifier).digest('base64url');
    const a = Buffer.from(expected); const b = Buffer.from(item.codeChallenge);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return item;
  }
}

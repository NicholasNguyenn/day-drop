import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { addDays, zonedParts, zonedTimeToInstant } from '../shared/dates.mjs';

export class ApiError extends Error {
  constructor(code, message, status = 400, resetAt = null) {
    super(message); Object.assign(this, { code, status, resetAt });
  }
}
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Usage accounting over any synchronous SQLite. `db` offers exec and
// prepare(sql).get/run as node:sqlite does; `transaction(fn)` runs fn atomically.
// Counters are only correct with a single writer: one host locally, or the one
// Durable Object on Cloudflare. Several hosts would need a shared atomic database.
export class QuotaCore {
  constructor({ db, transaction, now = Date.now, limits = {} }) {
    Object.assign(this, { db, transaction, now });
    this.limits = { daily: 5, ipDaily: 20, globalDaily: 100, burst: 6, globalBurst: 10, concurrency: 2, ...limits };
    this.db.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS counters (scope TEXT, bucket TEXT, value INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(scope,bucket));
      CREATE TABLE IF NOT EXISTS requests (client TEXT, id TEXT, lease INTEGER NOT NULL, active INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(client,id));
      CREATE INDEX IF NOT EXISTS counters_expires ON counters(expires);
      CREATE INDEX IF NOT EXISTS requests_expires ON requests(expires);
      CREATE INDEX IF NOT EXISTS requests_active ON requests(lease) WHERE active=1;`);
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('session-secret', randomBytes(32).toString('hex'));
    this.secret = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('session-secret').value;
  }
  hash(value) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  clock() {
    const ms = this.now(); const day = Math.floor(ms / 86_400_000); const minute = Math.floor(ms / 60_000);
    return { ms, day, minute, dayEnd: (day + 1) * 86_400_000, minuteEnd: (minute + 1) * 60_000 };
  }
  atomic(fn) {
    try { return this.transaction(fn); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('QUOTA_UNAVAILABLE', 'Usage checks are unavailable. No analysis was started.', 503);
    }
  }
  count(scope, bucket) { return this.db.prepare('SELECT value FROM counters WHERE scope=? AND bucket=?').get(scope, bucket)?.value || 0; }
  charge(scope, bucket, limit, expires, code, message, amount = 1) {
    if (this.count(scope, bucket) + amount > limit) throw new ApiError(code, message, 429, new Date(expires).toISOString());
    this.db.prepare('INSERT INTO counters VALUES (?,?,?,?) ON CONFLICT(scope,bucket) DO UPDATE SET value=value+excluded.value').run(scope, bucket, amount, expires);
  }
  chargeRolling(scope, amount, limit, ms, code, message) {
    const value = this.db.prepare('SELECT COALESCE(SUM(value),0) AS total,MIN(expires) AS reset FROM counters WHERE scope=? AND expires>?').get(scope, ms);
    if (value.total + amount > limit) throw new ApiError(code, message, 429, new Date(value.reset || ms + 60_000).toISOString());
    this.charge(scope, 'rolling:' + ms, Number.MAX_SAFE_INTEGER, ms + 60_000, code, message, amount);
  }
  usage(client) {
    try {
      const { day, dayEnd } = this.clock();
      return { limit: this.limits.daily, remaining: Math.max(0, this.limits.daily - this.count('client:' + this.hash(client), 'day:' + day)), resetsAt: new Date(dayEnd).toISOString() };
    } catch { throw new ApiError('QUOTA_UNAVAILABLE', 'Usage checks are unavailable.', 503); }
  }
  session(client, ip) {
    if (!uuid(client)) throw new ApiError('INVALID_INSTALLATION', 'Invalid installation identifier.');
    const { ms, minute, minuteEnd } = this.clock();
    this.atomic(() => {
      this.cleanup(ms);
      this.charge('session:' + this.hash(ip), 'minute:' + minute, 10, minuteEnd, 'THROTTLED', 'Too many session requests. Wait a minute.');
    });
    const expiresAt = new Date(ms + 3_600_000).toISOString();
    const payload = Buffer.from(JSON.stringify({ client, expiresAt })).toString('base64url');
    return { token: payload + '.' + this.hash(payload), expiresAt, usage: this.usage(client) };
  }
  authenticate(header) {
    const token = /^Bearer ([A-Za-z0-9_-]+\.[a-f0-9]{64})$/.exec(header || '')?.[1];
    try {
      if (!token || token.length > 512) throw new Error();
      const [payload, signature] = token.split('.');
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(this.hash(payload)))) throw new Error();
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!uuid(data.client) || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= this.now()) throw new Error();
      return data.client;
    } catch { throw new ApiError('SESSION_REQUIRED', 'Refresh your analysis session and try again.', 401); }
  }
  // Runs on every session and analysis. The indexes and the active=1 filter keep it to the
  // rows that actually expired; the hosting plan meters every row read or written.
  cleanup(ms) {
    this.db.prepare('DELETE FROM counters WHERE expires<=?').run(ms);
    this.db.prepare('DELETE FROM requests WHERE expires<=?').run(ms);
    this.db.prepare('UPDATE requests SET active=0 WHERE lease<=? AND active=1').run(ms);
  }
  reserve(client, id, ip, { inputTokens = 0 } = {}) {
    if (!uuid(id)) throw new ApiError('INVALID_REQUEST_ID', 'Invalid analysis identifier.');
    return this.atomic(() => {
      const { ms, day, minute, dayEnd, minuteEnd } = this.clock(); this.cleanup(ms);
      const key = this.hash(client);
      if (this.db.prepare('SELECT 1 FROM requests WHERE client=? AND id=?').get(key, id)) throw new ApiError('DUPLICATE_REQUEST', 'This analysis was already submitted. It will not be run twice.', 409);
      if (this.db.prepare('SELECT COUNT(*) AS count FROM requests WHERE active=1').get().count >= this.limits.concurrency) throw new ApiError('BUSY', 'Analysis is busy. Please try again shortly.', 429);
      this.charge('client:' + key, 'day:' + day, this.limits.daily, dayEnd, 'QUOTA_EXHAUSTED', 'Your free analyses are used for today. You can still edit drafts and download ICS.');
      this.charge('ip:' + this.hash(ip + ':' + day), 'day:' + day, this.limits.ipDaily, dayEnd, 'NETWORK_LIMIT', 'This network has reached its daily analysis allowance.');
      this.charge('global', 'day:' + day, this.limits.globalDaily, dayEnd, 'SERVICE_LIMIT', 'The free service has reached today’s allowance.');
      this.charge('ip:' + this.hash(ip), 'minute:' + minute, this.limits.burst, minuteEnd, 'THROTTLED', 'Too many analyses at once. Wait a minute.');
      this.charge('global', 'minute:' + minute, this.limits.globalBurst, minuteEnd, 'THROTTLED', 'Analysis is busy. Wait a minute.');
      if (this.limits.providerDaily) {
        this.chargeRolling('provider-rpm', 1, this.limits.globalBurst, ms, 'THROTTLED', 'The free service is busy. Wait a minute.');
        const date = zonedParts(new Date(ms), 'America/Los_Angeles').date;
        const reset = zonedTimeToInstant(addDays(date, 1), '00:00', 'America/Los_Angeles').getTime();
        this.charge('provider', 'pacific:' + date, this.limits.providerDaily, reset, 'PROVIDER_DAILY_LIMIT', 'The provider allowance is used for today.');
      }
      if (this.limits.tokenPerMinute) {
        if (!Number.isSafeInteger(inputTokens) || inputTokens < 1) throw new ApiError('INVALID_TOKEN_BUDGET', 'Input budget could not be checked.');
        this.chargeRolling('provider-tokens', inputTokens, this.limits.tokenPerMinute, ms, 'TOKEN_LIMIT', 'Analysis input is too large for the current free allowance. Try a smaller capture or wait a minute.');
      }
      this.db.prepare('INSERT INTO requests VALUES (?,?,?,1,?)').run(key, id, ms + 120_000, ms + 86_400_000);
      return this.usage(client);
    });
  }
  finish(client, id) {
    return this.atomic(() => this.db.prepare('UPDATE requests SET active=0 WHERE client=? AND id=?').run(this.hash(client), id));
  }
}

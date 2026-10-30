// Security helpers: anti-replay login signatures, session auth for REST,
// parent-PIN unlock tracking, CORS allow-list, security headers, rate limiting.

import { ethers } from 'ethers';
import * as store from './store.js';

// ---------- Login signature (EIP-191) with timestamp + single use ----------
// The signed text contains an issue time, so a captured signature expires after
// AUTH_WINDOW_MS and, once accepted, can never be used a second time.

export const AUTH_WINDOW_MS = 5 * 60 * 1000;
export const AUTH_MESSAGE = (address, issuedAt) => `Battle Arena login for ${address}\nIssued: ${issuedAt}`;

const usedSignatures = new Map(); // signature -> expiry (ms)

export function verifyAuthSignature(signature, address, issuedAt) {
  if (!signature || typeof signature !== 'string' || !address || typeof address !== 'string') return false;
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > AUTH_WINDOW_MS) return false;
  if (usedSignatures.has(signature)) return false;
  try {
    const recovered = ethers.verifyMessage(AUTH_MESSAGE(address, ts), signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) return false;
    usedSignatures.set(signature, Date.now() + AUTH_WINDOW_MS * 2);
    return true;
  } catch {
    return false;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [sig, exp] of usedSignatures) if (exp < now) usedSignatures.delete(sig);
}, 60_000).unref();

// ---------- REST session auth ----------

export const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/** Express middleware: requires `Authorization: Bearer <session token>`. Sets req.auth = { address, token }. */
export function requireSession(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const address = token ? store.addressForSession(token) : null;
  if (!address) return res.status(401).json({ error: 'Login required' });
  req.auth = { address, token };
  next();
}

// ---------- Parent PIN unlock (per login session) ----------

const PARENT_UNLOCK_MS = 15 * 60 * 1000;
const parentUnlocks = new Map(); // token -> expiry (ms)

export const unlockParent = token => parentUnlocks.set(token, Date.now() + PARENT_UNLOCK_MS);
export const lockParent = token => parentUnlocks.delete(token);
export function isParentUnlocked(token) {
  const exp = parentUnlocks.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { parentUnlocks.delete(token); return false; }
  return true;
}

/**
 * May the logged-in account administer `kidAddress`'s chores/vouchers?
 *  - a linked parent account (kid.parentAddress === session address), or
 *  - the kid's own session, but only after the Parent PIN was entered.
 */
export function canAdminister(auth, kidAddress) {
  if (!auth || !kidAddress) return false;
  const kid = store.getPlayer(kidAddress);
  if (kid && same(kid.parentAddress, auth.address)) return true;
  return same(kidAddress, auth.address) && isParentUnlocked(auth.token);
}

// ---------- CORS allow-list ----------
// Allowed: no Origin (curl, server-to-server), localhost, private LAN ranges
// (so teammates on the same network can play), and anything in ALLOWED_ORIGINS
// (comma-separated, e.g. your deployed site). Random websites are rejected.

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;

export function isAllowedOrigin(origin) {
  return !origin || EXTRA_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

export const corsOptions = {
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
};

// ---------- Security headers + rate limit ----------

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}

/** Simple in-memory fixed-window limiter per IP. */
export function rateLimit({ windowMs = 60_000, max = 300 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.resetAt < now) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let h = hits.get(ip);
    if (!h || h.resetAt < now) { h = { count: 0, resetAt: now + windowMs }; hits.set(ip, h); }
    if (++h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Slow down.' });
    }
    next();
  };
}

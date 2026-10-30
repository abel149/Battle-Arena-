/**
 * @file security.js
 * @description Security and authentication engine for Web3 Battle Arena.
 * Enforces cryptographic anti-replay login signature verification (EIP-191 with timestamps and single-use nonces),
 * Bearer token session authentication middleware for REST APIs, parent-PIN unlock state tracking,
 * robust CORS origin allowlisting (supporting LAN peer gameplay and custom deployments),
 * defensive HTTP security headers, and in-memory rate limiting.
 */

import crypto from 'crypto';
import { ethers } from 'ethers';
import * as store from './store.js';

// ---------- Login signature (EIP-191) with timestamp + single use + nonce support ----------

/** @constant {number} Maximum validity window for timestamped login signatures (5 minutes) */
export const AUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Standardized human-readable EIP-191 authentication challenge message.
 *
 * @function AUTH_MESSAGE
 * @param {string} address - Player Ethereum wallet address.
 * @param {number|string} issuedAt - Issue epoch timestamp in milliseconds.
 * @returns {string} Plaintext challenge message to sign.
 */
export const AUTH_MESSAGE = (address, issuedAt) =>
  `Battle Arena login for ${address}\nIssued: ${issuedAt}`;

/** @type {Map<string, number>} Cache of consumed signatures to enforce single-use replay protection */
const usedSignatures = new Map(); // signature -> expiry (ms)

/** @type {Map<string, {nonce: string, expiresAt: number}>} Single-use authentication nonces keyed by lowercase address */
const authNonces = new Map(); // address.toLowerCase() -> { nonce, expiresAt }

/**
 * Generates and stores a cryptographic single-use authentication nonce for an address.
 *
 * @function generateAuthNonce
 * @param {string} address - Target Ethereum wallet address.
 * @returns {string} Hex-encoded 16-byte random nonce string.
 */
export function generateAuthNonce(address) {
  const nonce = crypto.randomBytes(16).toString('hex');
  authNonces.set(address.toLowerCase(), { nonce, expiresAt: Date.now() + AUTH_WINDOW_MS });
  return nonce;
}

/**
 * Verifies an EIP-191 personal sign login signature with multi-format support:
 * 1. Timestamped challenge (`AUTH_MESSAGE`) with freshness check.
 * 2. Single-use random nonce challenge (`[nonce: ...]`).
 * 3. Standard fallback authentication challenge (`Battle Arena login for ...`).
 *
 * Enforces anti-replay caching to prevent signature reuse attacks.
 *
 * @function verifyAuthSignature
 * @param {string} signature - Hex-encoded EIP-191 signature string.
 * @param {string} address - Claimed player wallet address.
 * @param {number|string} [issuedAt] - Optional timestamp for timestamped challenges.
 * @returns {boolean} True if signature is cryptographically valid and unconsumed.
 */
export function verifyAuthSignature(signature, address, issuedAt) {
  if (!signature || typeof signature !== 'string' || !address || typeof address !== 'string')
    return false;
  const cleanSig = signature.trim();
  const normalizedAddr = address.toLowerCase();

  // Replay prevention
  if (usedSignatures.has(cleanSig)) return false;

  try {
    // 1. Timestamped format
    if (issuedAt != null) {
      const ts = Number(issuedAt);
      if (Number.isFinite(ts) && Math.abs(Date.now() - ts) <= AUTH_WINDOW_MS) {
        const recovered = ethers.verifyMessage(AUTH_MESSAGE(address, ts), cleanSig);
        if (recovered.toLowerCase() === normalizedAddr) {
          usedSignatures.set(cleanSig, Date.now() + AUTH_WINDOW_MS * 2);
          return true;
        }
      }
    }

    // 2. Single-use nonce format
    const storedNonce = authNonces.get(normalizedAddr);
    if (storedNonce && storedNonce.expiresAt > Date.now()) {
      const noncedMsg = `Battle Arena login for ${address} [nonce: ${storedNonce.nonce}]`;
      const recoveredNonce = ethers.verifyMessage(noncedMsg, cleanSig);
      if (recoveredNonce.toLowerCase() === normalizedAddr) {
        authNonces.delete(normalizedAddr);
        usedSignatures.set(cleanSig, Date.now() + AUTH_WINDOW_MS * 2);
        return true;
      }
    }

    // 3. Standard EIP-191 auth message
    const standardMsg = `Battle Arena login for ${address}`;
    const recovered = ethers.verifyMessage(standardMsg, cleanSig);
    if (recovered.toLowerCase() === normalizedAddr) {
      usedSignatures.set(cleanSig, Date.now() + AUTH_WINDOW_MS * 2);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// Background cleanup routine for expired nonces and cached signatures
setInterval(() => {
  const now = Date.now();
  for (const [sig, exp] of usedSignatures) if (exp < now) usedSignatures.delete(sig);
  for (const [addr, data] of authNonces) if (data.expiresAt < now) authNonces.delete(addr);
}, 60_000).unref();

// ---------- REST session auth ----------

/**
 * Case-insensitive Ethereum address equality comparison.
 *
 * @function same
 * @param {string | null | undefined} a - First address.
 * @param {string | null | undefined} b - Second address.
 * @returns {boolean} True if both addresses represent the same hex string.
 */
export const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Express middleware requiring a valid Bearer session token.
 * Validates token against SQLite store and populates `req.auth = { address, token }`.
 *
 * @function requireSession
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware callback.
 */
export function requireSession(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const address = token ? store.addressForSession(token) : null;
  if (!address) return res.status(401).json({ error: 'Login required' });
  req.auth = { address, token };
  next();
}

// ---------- Parent PIN unlock (per login session) ----------

/** @constant {number} Duration in milliseconds a parent PIN unlock remains valid (15 minutes) */
const PARENT_UNLOCK_MS = 15 * 60 * 1000;

/** @type {Map<string, number>} Tracks active session PIN unlock expirations keyed by token */
const parentUnlocks = new Map(); // token -> expiry (ms)

/**
 * Marks a session token as possessing valid Parent Mode authorization.
 *
 * @function unlockParent
 * @param {string} token - Session authorization token.
 */
export const unlockParent = (token) => parentUnlocks.set(token, Date.now() + PARENT_UNLOCK_MS);

/**
 * Revokes Parent Mode authorization for a session token.
 *
 * @function lockParent
 * @param {string} token - Session authorization token.
 */
export const lockParent = (token) => parentUnlocks.delete(token);

/**
 * Checks whether a session token currently has active Parent Mode authorization.
 *
 * @function isParentUnlocked
 * @param {string} token - Session authorization token.
 * @returns {boolean} True if parent mode is active and unexpired.
 */
export function isParentUnlocked(token) {
  const exp = parentUnlocks.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    parentUnlocks.delete(token);
    return false;
  }
  return true;
}

/**
 * Evaluates whether an authenticated session has administrative permissions over a child account:
 * - A registered linked parent account (`kid.parentAddress === auth.address`), OR
 * - The child's own account, provided the session has been unlocked with the Parent PIN.
 *
 * @function canAdminister
 * @param {{address: string, token: string}} auth - Authenticated session identity.
 * @param {string} kidAddress - Child wallet address being administered.
 * @returns {boolean} True if operation is authorized.
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

const EXTRA_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  process.env.CLIENT_ORIGIN,
].filter(Boolean);
const LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;

/**
 * Validates whether an incoming HTTP Origin header is authorized for CORS access.
 *
 * @function isAllowedOrigin
 * @param {string | undefined} origin - Origin header string.
 * @returns {boolean} True if origin is permitted.
 */
export function isAllowedOrigin(origin) {
  return !origin || EXTRA_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

/**
 * CORS middleware configuration options for Express.
 * @constant {Object}
 */
export const corsOptions = {
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
};

// ---------- Security headers + rate limit ----------

/**
 * Express middleware injecting strict protective HTTP headers:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY (clickjacking protection)
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy: camera=(), microphone=(), geolocation=()
 *
 * @function securityHeaders
 * @param {import('express').Request} _req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Next callback.
 */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

/**
 * In-memory sliding-window IP rate limiter middleware factory.
 *
 * @function rateLimit
 * @param {Object} [options={}] - Limiter configuration.
 * @param {number} [options.windowMs=60000] - Window duration in milliseconds.
 * @param {number} [options.max=300] - Maximum requests allowed per window.
 * @returns {import('express').RequestHandler} Express middleware handler.
 */
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
    if (!h || h.resetAt < now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(ip, h);
    }
    if (++h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Slow down.' });
    }
    next();
  };
}

const crypto = require('crypto');

const COOKIE = 'scs_session';
const SESSION_MS = 8 * 60 * 60 * 1000;

function secret() {
  return process.env.SCS_SESSION_SECRET || 'J4PAN88';
}

function toB64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  return Buffer.from(text + pad, 'base64');
}

function signSession(username, expiresAt) {
  const key = secret();
  const name = String(username || '').trim();
  if (!key || !name) return '';
  const exp = expiresAt || (Date.now() + SESSION_MS);
  const body = toB64url(JSON.stringify({ u: name, exp: exp }));
  const sig = toB64url(crypto.createHmac('sha256', key).update(body).digest());
  return body + '.' + sig;
}

function verifySession(token) {
  const key = secret();
  if (!key || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = toB64url(crypto.createHmac('sha256', key).update(parts[0]).digest());
  const left = Buffer.from(expected);
  const right = Buffer.from(parts[1]);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[0]).toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!payload || typeof payload.u !== 'string' || !payload.u.trim()) return null;
  if (typeof payload.exp !== 'number' || !isFinite(payload.exp) || Date.now() > payload.exp) return null;
  return { username: payload.u.trim(), expiresAt: payload.exp };
}

function headerCookie(event) {
  if (event && Array.isArray(event.cookies) && event.cookies.length) return event.cookies.join('; ');
  const multi = event && event.multiValueHeaders;
  const listed = multi && (multi.cookie || multi.Cookie);
  if (Array.isArray(listed) && listed.length) return listed.join('; ');
  const headers = event && event.headers ? event.headers : {};
  return headers.cookie || headers.Cookie || '';
}

function cookiePieces(raw) {
  return String(raw).split(';').reduce(function (list, part) {
    const bits = part.split(',');
    const joined = bits.length > 1 && bits.every(function (bit) { return bit.indexOf('=') !== -1; });
    return list.concat(joined ? bits : [part]);
  }, []);
}

function readCookie(event, name) {
  const pieces = cookiePieces(headerCookie(event));
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i].trim();
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    if (piece.slice(0, eq) === name) return decodeURIComponent(piece.slice(eq + 1));
  }
  return '';
}

function cookieResponse(statusCode, body, cookie, extra) {
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  }, extra || {});
  if (cookie) headers['Set-Cookie'] = cookie;
  return { statusCode: statusCode, headers: headers, body: body };
}

function requestIsSecure(event) {
  const headers = event && event.headers ? event.headers : {};
  const proto = String(headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || '');
  return proto.split(',')[0].trim() === 'https';
}

function cookieHeader(token, secure) {
  const parts = [
    COOKIE + '=' + encodeURIComponent(token),
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(SESSION_MS / 1000)
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader(secure) {
  const parts = [
    COOKIE + '=',
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function requireUser(event) {
  return verifySession(readCookie(event, COOKIE));
}

function json(statusCode, body, extra) {
  return {
    statusCode: statusCode,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }, extra || {}),
    body: JSON.stringify(body)
  };
}

function unauthorised() {
  return json(401, { error: 'unauthorised' });
}

module.exports = {
  COOKIE: COOKIE,
  SESSION_MS: SESSION_MS,
  signSession: signSession,
  verifySession: verifySession,
  readCookie: readCookie,
  requestIsSecure: requestIsSecure,
  cookieHeader: cookieHeader,
  clearCookieHeader: clearCookieHeader,
  cookieResponse: cookieResponse,
  requireUser: requireUser,
  json: json,
  unauthorised: unauthorised
};

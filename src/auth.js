import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from './db.js';
import { asyncRoute, idSchema, validate } from './http.js';

function verifyAccessToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256' || header.typ && header.typ !== 'JWT') throw new Error('Unsupported token');
  const actual = Buffer.from(encodedSignature, 'base64url');
  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid signature');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Expired token');
  if (typeof payload.nbf === 'number' && payload.nbf > now) throw new Error('Token not active');
  if (payload.iss !== 'drift-api') throw new Error('Wrong issuer');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes('drift')) throw new Error('Wrong audience');
  return payload;
}

export const requireUser = asyncRoute(async (req, res, next) => {
  let raw;
  const authorization = req.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      const error = new Error('Token authentication is not configured');
      error.status = 503;
      throw error;
    }
    try {
      const payload = verifyAccessToken(authorization.slice(7), secret);
      raw = payload.sub;
    } catch {
      const error = new Error('Invalid or expired access token');
      error.status = 401;
      throw error;
    }
  } else if (process.env.NODE_ENV === 'development') {
    raw = req.get('x-user-id');
  }
  if (!raw) {
    const error = new Error(process.env.NODE_ENV === 'development'
      ? 'X-User-Id header is required' : 'Bearer access token is required');
    error.status = 401;
    throw error;
  }
  req.userId = validate(idSchema, raw);
  const user = await prisma.appUser.findUnique({ where: { userId: req.userId }, select: { userId: true } });
  if (!user) {
    const error = new Error('Unknown user');
    error.status = 401;
    throw error;
  }
  next();
});

export async function requireBuildingMember(userId, buildingId, edit = false) {
  const member = await prisma.buildingMember.findUnique({
    where: { buildingId_userId: { buildingId, userId } }, select: { role: true }
  });
  if (!member || (edit && !['OWNER', 'EDITOR'].includes(member.role))) {
    const error = new Error('You do not have permission for this building');
    error.status = member ? 403 : 404;
    throw error;
  }
  return member;
}

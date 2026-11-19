import { prisma } from './db.js';
import { asyncRoute, idSchema, validate } from './http.js';

export const requireUser = asyncRoute(async (req, res, next) => {
  const raw = req.get('x-user-id');
  if (!raw) {
    const error = new Error('X-User-Id header is required');
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

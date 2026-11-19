import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const user = await prisma.appUser.upsert({
    where: { email: 'demo@drift.local' },
    update: { displayName: 'Drift Demo User' },
    create: { displayName: 'Drift Demo User', email: 'demo@drift.local' }
  });
  let building = await prisma.building.findFirst({ where: { name: 'Drift Demo Home', address: '1 Solar Lane, Bengaluru' } });
  if (!building) building = await prisma.building.create({
    data: { name: 'Drift Demo Home', address: '1 Solar Lane, Bengaluru', timezone: 'Asia/Kolkata' }
  });
  await prisma.buildingMember.upsert({
    where: { buildingId_userId: { buildingId: building.buildingId, userId: user.userId } },
    update: { role: 'OWNER' },
    create: { buildingId: building.buildingId, userId: user.userId, role: 'OWNER' }
  });
  console.log(`Seeded demo user ${user.userId} and building ${building.buildingId}`);
} finally {
  await prisma.$disconnect();
}

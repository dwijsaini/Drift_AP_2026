import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate realistic hourly EnergyPeriod data for a residential solar home.
 * Solar generation peaks midday (~4.5 kWh at noon) using a sine-wave.
 * Consumption is flat-ish, slightly higher in evenings.
 *
 * @param {bigint} buildingId
 * @param {Date}   startDate   First hour (inclusive)
 * @param {number} hours       Number of hourly readings to generate
 * @returns {Array<object>}
 */
function generateHomeReadings(buildingId, startDate, hours) {
  const rows = [];
  for (let h = 0; h < hours; h++) {
    const periodStart = new Date(startDate.getTime() + h * 3_600_000);
    const periodEnd   = new Date(periodStart.getTime() + 3_600_000);
    const hour = periodStart.getUTCHours(); // 0-23 in UTC (seed data in UTC)

    // Solar generation: sine wave peaking at noon (hour 12 UTC ≈ 17:30 IST)
    // Peak ~4.5 kWh, zero before 6am and after 19pm
    let generatedKwh = 0;
    if (hour >= 6 && hour <= 19) {
      const angle = Math.PI * (hour - 6) / 13;      // 0..π over daylight hours
      const rawPeak = 4.5 + 0.3 * Math.sin(h * 0.07); // slight day-to-day variation
      generatedKwh = Math.max(0, rawPeak * Math.sin(angle));
    }

    // Consumption: base ~1.4 kWh/h with higher evening usage (18-22h)
    const eveningBoost = hour >= 18 && hour <= 22 ? 0.9 : 0;
    const morningBoost = hour >= 7 && hour <= 9 ? 0.5 : 0;
    const noise = 0.15 * Math.sin(h * 1.3 + 0.5); // deterministic pseudo-noise
    const consumedKwh = Math.max(0.3, 1.4 + eveningBoost + morningBoost + noise);

    rows.push({
      buildingId,
      periodStart,
      periodEnd,
      generatedKwh: parseFloat(generatedKwh.toFixed(3)),
      consumedKwh:  parseFloat(consumedKwh.toFixed(3)),
      source: 'API',
    });
  }
  return rows;
}

/**
 * Generate realistic hourly EnergyPeriod data for a commercial office tower.
 * Higher consumption during business hours (8am-6pm), low at night.
 * Higher solar capacity: peaks up to 12 kWh at noon.
 *
 * @param {bigint} buildingId
 * @param {Date}   startDate
 * @param {number} hours
 * @returns {Array<object>}
 */
function generateOfficeReadings(buildingId, startDate, hours) {
  const rows = [];
  for (let h = 0; h < hours; h++) {
    const periodStart = new Date(startDate.getTime() + h * 3_600_000);
    const periodEnd   = new Date(periodStart.getTime() + 3_600_000);
    const hour = periodStart.getUTCHours();

    // Solar: larger array, peak ~12 kWh
    let generatedKwh = 0;
    if (hour >= 6 && hour <= 19) {
      const angle = Math.PI * (hour - 6) / 13;
      const rawPeak = 12.0 + 0.5 * Math.sin(h * 0.05);
      generatedKwh = Math.max(0, rawPeak * Math.sin(angle));
    }

    // Office consumption: heavy during business hours
    const isBusinessHour = hour >= 8 && hour <= 18;
    const baseConsumption = isBusinessHour ? 5.5 : 0.8;
    const lunchDip = hour === 13 ? -1.0 : 0;                    // slight dip at lunch
    const morningRamp = hour === 8 ? -1.5 : 0;                   // warming up
    const noise = 0.4 * Math.sin(h * 0.9 + 1.2);
    const consumedKwh = Math.max(0.4, baseConsumption + lunchDip + morningRamp + noise);

    rows.push({
      buildingId,
      periodStart,
      periodEnd,
      generatedKwh: parseFloat(generatedKwh.toFixed(3)),
      consumedKwh:  parseFloat(consumedKwh.toFixed(3)),
      source: 'API',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------

try {
  // --- Users ---
  const demoUser = await prisma.appUser.upsert({
    where:  { email: 'demo@drift.local' },
    update: { displayName: 'Drift Demo User' },
    create: { displayName: 'Drift Demo User', email: 'demo@drift.local' },
  });

  const priya = await prisma.appUser.upsert({
    where:  { email: 'priya@drift.local' },
    update: { displayName: 'Priya Mehta' },
    create: { displayName: 'Priya Mehta', email: 'priya@drift.local' },
  });

  // --- Buildings ---
  let homeBuilding = await prisma.building.findFirst({
    where: { name: 'Drift Demo Home', address: '1 Solar Lane, Bengaluru' },
  });
  if (!homeBuilding) {
    homeBuilding = await prisma.building.create({
      data: { name: 'Drift Demo Home', address: '1 Solar Lane, Bengaluru', timezone: 'Asia/Kolkata' },
    });
  }

  let officeBuilding = await prisma.building.findFirst({
    where: { name: 'Green Office Tower' },
  });
  if (!officeBuilding) {
    officeBuilding = await prisma.building.create({
      data: { name: 'Green Office Tower', address: '14 Koramangala 4th Block, Bengaluru', timezone: 'Asia/Kolkata' },
    });
  }

  // --- Memberships ---
  // demo user = OWNER of both buildings
  await prisma.buildingMember.upsert({
    where:  { buildingId_userId: { buildingId: homeBuilding.buildingId, userId: demoUser.userId } },
    update: { role: 'OWNER' },
    create: { buildingId: homeBuilding.buildingId, userId: demoUser.userId, role: 'OWNER' },
  });
  await prisma.buildingMember.upsert({
    where:  { buildingId_userId: { buildingId: officeBuilding.buildingId, userId: demoUser.userId } },
    update: { role: 'OWNER' },
    create: { buildingId: officeBuilding.buildingId, userId: demoUser.userId, role: 'OWNER' },
  });
  // priya = EDITOR of Green Office Tower
  await prisma.buildingMember.upsert({
    where:  { buildingId_userId: { buildingId: officeBuilding.buildingId, userId: priya.userId } },
    update: { role: 'EDITOR' },
    create: { buildingId: officeBuilding.buildingId, userId: priya.userId, role: 'EDITOR' },
  });
  // priya = VIEWER of Demo Home
  await prisma.buildingMember.upsert({
    where:  { buildingId_userId: { buildingId: homeBuilding.buildingId, userId: priya.userId } },
    update: { role: 'VIEWER' },
    create: { buildingId: homeBuilding.buildingId, userId: priya.userId, role: 'VIEWER' },
  });

  // --- Energy period seed data ---
  // 90 hourly readings from 2026-10-01T00:00:00Z for each building
  const seedStart = new Date('2026-10-01T00:00:00Z');
  const NUM_HOURS = 90;

  const homeRows   = generateHomeReadings(homeBuilding.buildingId, seedStart, NUM_HOURS);
  const officeRows = generateOfficeReadings(officeBuilding.buildingId, seedStart, NUM_HOURS);

  const homeResult = await prisma.energyPeriod.createMany({
    data: homeRows,
    skipDuplicates: true,
  });

  const officeResult = await prisma.energyPeriod.createMany({
    data: officeRows,
    skipDuplicates: true,
  });

  console.log(`Seeded users: ${demoUser.userId} (demo), ${priya.userId} (priya)`);
  console.log(`Seeded buildings: ${homeBuilding.buildingId} (Demo Home), ${officeBuilding.buildingId} (Green Office Tower)`);
  console.log(`EnergyPeriod rows created: ${homeResult.count} (home) + ${officeResult.count} (office) = ${homeResult.count + officeResult.count} total`);
} finally {
  await prisma.$disconnect();
}

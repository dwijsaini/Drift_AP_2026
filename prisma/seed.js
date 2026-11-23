import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate realistic hourly EnergyPeriod data for a residential solar home.
 * Solar generation peaks midday (~12:00-13:00 IST) using a sine-wave.
 * Strictly 0 generation during nighttime (19:00 - 06:00).
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
    
    // Calculate local hour in Asia/Kolkata (UTC + 5.5 hours)
    const istTime = new Date(periodStart.getTime() + (5.5 * 3600 * 1000));
    const localHour = istTime.getUTCHours();
    const dayIndex = Math.floor(h / 24);

    // Weather condition variation per day: sunny (0.9-1.0), partly cloudy (0.55-0.75), overcast (0.25-0.45)
    const weatherVariations = [0.95, 0.90, 0.65, 0.35];
    const weatherFactor = weatherVariations[dayIndex % weatherVariations.length];

    // Solar generation: sine wave peaking at local noon (12:30 IST)
    let generatedKwh = 0;
    if (localHour >= 6 && localHour <= 18) {
      const angle = Math.PI * (localHour - 6) / 12.0;
      const peakSolar = 4.8 * weatherFactor;
      generatedKwh = Math.max(0, peakSolar * Math.sin(angle));
    }

    // Residential consumption:
    // Low night baseload (~0.6 kWh)
    // Morning wake-up bump 7-9 AM (~2.2 kWh)
    // Low daytime ~1.1 kWh
    // Evening cooking & lighting 18-22 (~3.2 kWh)
    let base = 0.6;
    if (localHour >= 7 && localHour <= 9) base = 2.2;
    else if (localHour >= 10 && localHour <= 17) base = 1.1;
    else if (localHour >= 18 && localHour <= 22) base = 3.2;

    const pseudoNoise = 0.15 * Math.sin(h * 1.37 + 0.4);
    const consumedKwh = Math.max(0.35, base + pseudoNoise);

    const netDeficit = Math.max(0, consumedKwh - generatedKwh);
    const netSurplus = Math.max(0, generatedKwh - consumedKwh);

    rows.push({
      buildingId,
      periodStart,
      periodEnd,
      generatedKwh: parseFloat(generatedKwh.toFixed(3)),
      consumedKwh:  parseFloat(consumedKwh.toFixed(3)),
      gridImportKwh: parseFloat(netDeficit.toFixed(3)),
      batteryChargeKwh: parseFloat((netSurplus * 0.7).toFixed(3)),
      batteryDischargeKwh: parseFloat((netDeficit * 0.4).toFixed(3)),
      source: 'API',
    });
  }
  return rows;
}

/**
 * Generate realistic hourly EnergyPeriod data for a commercial office tower.
 * Higher consumption during business hours (8am-6pm), low at night and weekends.
 * Higher solar capacity: peaks up to 14.5 kWh at noon.
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
    
    // Local hour in Asia/Kolkata
    const istTime = new Date(periodStart.getTime() + (5.5 * 3600 * 1000));
    const localHour = istTime.getUTCHours();
    const dayIndex = Math.floor(h / 24);

    const weatherVariations = [0.92, 0.88, 0.55, 0.40];
    const weatherFactor = weatherVariations[dayIndex % weatherVariations.length];

    // Solar: commercial rooftop array, peak ~14.5 kWh
    let generatedKwh = 0;
    if (localHour >= 6 && localHour <= 18) {
      const angle = Math.PI * (localHour - 6) / 12.0;
      const peakSolar = 14.5 * weatherFactor;
      generatedKwh = Math.max(0, peakSolar * Math.sin(angle));
    }

    // Office consumption: heavy during 8 AM – 6 PM
    const isBusinessHour = localHour >= 8 && localHour <= 18;
    const baseConsumption = isBusinessHour ? 8.5 : 1.2;
    const lunchDip = localHour === 13 ? -1.2 : 0;
    const morningRamp = localHour === 8 ? -2.0 : 0;
    const noise = 0.3 * Math.sin(h * 0.91 + 1.1);
    const consumedKwh = Math.max(0.5, baseConsumption + lunchDip + morningRamp + noise);

    const netDeficit = Math.max(0, consumedKwh - generatedKwh);
    const netSurplus = Math.max(0, generatedKwh - consumedKwh);

    rows.push({
      buildingId,
      periodStart,
      periodEnd,
      generatedKwh: parseFloat(generatedKwh.toFixed(3)),
      consumedKwh:  parseFloat(consumedKwh.toFixed(3)),
      gridImportKwh: parseFloat(netDeficit.toFixed(3)),
      batteryChargeKwh: parseFloat((netSurplus * 0.6).toFixed(3)),
      batteryDischargeKwh: parseFloat((netDeficit * 0.5).toFixed(3)),
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

  await prisma.energyPeriod.deleteMany({});

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

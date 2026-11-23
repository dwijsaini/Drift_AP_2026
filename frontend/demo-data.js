// Demo Data Generator for Preview Mode
// Generates realistic weather-varied solar readings (clear, cloudy, rainy, seasonal variation)
// All records are strictly labeled as "[DEMO DATA]"

export function generateRealisticDemoData(startDate = new Date('2026-10-01T00:00:00')) {
  const readings = [];
  const hours = 168; // 7 full days of hourly interval readings

  // Weather profiles for each day:
  // Day 0: Clear Sunny (factor 1.0)
  // Day 1: Sunny with haze (factor 0.88)
  // Day 2: Partly Cloudy with dips (factor 0.65)
  // Day 3: Overcast / Rainy Monsoon (factor 0.28)
  // Day 4: Clearing after rain (factor 0.72)
  // Day 5: Clear Weekend (factor 0.96)
  // Day 6: Clear Sunny (factor 1.02)
  const dayWeatherProfiles = [1.0, 0.88, 0.65, 0.28, 0.72, 0.96, 1.02];

  for (let h = 0; h < hours; h++) {
    const periodStart = new Date(startDate.getTime() + h * 3_600_000);
    const periodEnd = new Date(periodStart.getTime() + 3_600_000);
    const hourOfDay = periodStart.getHours();
    const dayIndex = Math.floor(h / 24) % dayWeatherProfiles.length;
    const weather = dayWeatherProfiles[dayIndex];

    // Solar generation (strictly daylight 06:00 to 19:00)
    let generatedKwh = 0;
    if (hourOfDay >= 6 && hourOfDay <= 18) {
      const angle = Math.PI * (hourOfDay - 6) / 12.0;
      // Added realistic cloud dip noise on partly cloudy days
      const cloudDip = dayIndex === 2 && (hourOfDay === 11 || hourOfDay === 13) ? 0.45 : 1.0;
      const peak = 5.2 * weather * cloudDip;
      generatedKwh = Math.max(0, peak * Math.sin(angle));
    }

    // Diurnal residential consumption:
    // Overnight baseload (~0.55 kWh)
    // Morning wake-up bump 7-9 AM (~2.2 kWh)
    // Daytime baseline (~1.0 kWh, higher on weekend day 5-6)
    // Evening peak 18-22 PM (~3.4 kWh)
    const isWeekend = dayIndex >= 5;
    let base = 0.55;
    if (hourOfDay >= 7 && hourOfDay <= 9) base = 2.2;
    else if (hourOfDay >= 10 && hourOfDay <= 17) base = isWeekend ? 1.8 : 1.0;
    else if (hourOfDay >= 18 && hourOfDay <= 22) base = isWeekend ? 3.8 : 3.2;

    const pseudoNoise = 0.12 * Math.sin(h * 1.4 + 0.3);
    const consumedKwh = Math.max(0.35, base + pseudoNoise);

    const netDeficit = Math.max(0, consumedKwh - generatedKwh);
    const netSurplus = Math.max(0, generatedKwh - consumedKwh);

    readings.push({
      id: `demo-${h}`,
      periodStart: periodStart.toISOString().slice(0, 16),
      periodEnd: periodEnd.toISOString().slice(0, 16),
      generatedKwh: parseFloat(generatedKwh.toFixed(3)),
      consumedKwh: parseFloat(consumedKwh.toFixed(3)),
      gridImportKwh: parseFloat(netDeficit.toFixed(3)),
      batteryChargeKwh: parseFloat((netSurplus * 0.7).toFixed(3)),
      batteryDischargeKwh: parseFloat((netDeficit * 0.4).toFixed(3)),
      source: 'MANUAL [DEMO DATA]',
      isDemo: true
    });
  }

  return {
    buildingName: 'Demo Solar Home [DEMO DATA]',
    readings
  };
}

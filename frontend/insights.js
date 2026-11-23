// Plain-Language Insights Engine & CO2 Avoided Calculator
// Generates deterministic rule-based findings without external AI dependencies

export function computeInsights(readings, emissionFactor = 0.716) {
  if (!readings || readings.length === 0) {
    return {
      co2AvoidedKg: 0,
      peakWindowText: '11:00 AM – 2:00 PM',
      peakWindowNote: 'Awaiting interval data',
      worstDeficitText: '—',
      worstDeficitNote: 'No deficit periods recorded',
      missedGenText: '0.0 kWh',
      missedGenNote: 'No interval gaps detected'
    };
  }

  // 1. Total Generated kWh -> CO2 avoided
  const totalGen = readings.reduce((s, r) => s + (Number(r.generatedKwh) || 0), 0);
  const co2AvoidedKg = totalGen * emissionFactor;

  // 2. Best solar window (aggregate hourly generation)
  const hourlyGen = Array(24).fill(0);
  const hourlyCount = Array(24).fill(0);
  readings.forEach(r => {
    if (!r.periodStart) return;
    const hr = new Date(r.periodStart).getHours();
    hourlyGen[hr] += Number(r.generatedKwh) || 0;
    hourlyCount[hr] += 1;
  });

  let best3HourStart = 11;
  let max3HourSum = 0;
  for (let h = 6; h <= 16; h++) {
    const sum = (hourlyGen[h] || 0) + (hourlyGen[h + 1] || 0) + (hourlyGen[h + 2] || 0);
    if (sum > max3HourSum) {
      max3HourSum = sum;
      best3HourStart = h;
    }
  }

  const formatHour = (h) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    return `${displayHour}:00 ${period}`;
  };

  const peakWindowText = `${formatHour(best3HourStart)} – ${formatHour(best3HourStart + 3)}`;
  const peakWindowNote = `Optimal window for discretionary electrical load (water pumps, EV charging)`;

  // 3. Biggest deficit interval
  let maxDeficit = 0;
  let maxDeficitReading = null;
  readings.forEach(r => {
    const gen = Number(r.generatedKwh) || 0;
    const con = Number(r.consumedKwh) || 0;
    const def = con - gen;
    if (def > maxDeficit) {
      maxDeficit = def;
      maxDeficitReading = r;
    }
  });

  const worstDeficitText = maxDeficitReading
    ? `${maxDeficit.toFixed(1)} kWh (${String(maxDeficitReading.periodStart).slice(5, 16).replace('T', ' ')})`
    : 'None (100% self-powered)';
  const worstDeficitNote = maxDeficitReading
    ? `Highest recorded grid dependency interval`
    : `All consumption fully covered by solar`;

  // 4. Missed generation from gaps
  const missingHours = readings.reduce((s, r) => s + (Number(r.missingPeriodCount) || 0), 0);
  const avgGenPerHour = totalGen / Math.max(1, readings.length);
  const estimatedMissedKwh = missingHours * avgGenPerHour;

  const missedGenText = missingHours > 0
    ? `~${estimatedMissedKwh.toFixed(1)} kWh (${missingHours} missing slots)`
    : '0.0 kWh (complete data)';
  const missedGenNote = missingHours > 0
    ? `Estimated solar production unrecorded due to telemetry gaps`
    : `Interval telemetry has 100% completeness`;

  return {
    co2AvoidedKg: parseFloat(co2AvoidedKg.toFixed(1)),
    peakWindowText,
    peakWindowNote,
    worstDeficitText,
    worstDeficitNote,
    missedGenText,
    missedGenNote
  };
}

// Goals Manager & Progress Projection
// Tracks coverage % and monthly surplus target with on-track / at-risk projections

export function evaluateGoals(readings, goals = { targetCoveragePct: 80, targetSurplusKwh: 150 }) {
  if (!readings || readings.length === 0) {
    return {
      coveragePct: 0,
      surplusKwh: 0,
      coverageOnTrack: false,
      surplusOnTrack: false,
      projectedSurplusKwh: 0
    };
  }

  const totalGen = readings.reduce((s, r) => s + (Number(r.generatedKwh) || 0), 0);
  const totalCon = readings.reduce((s, r) => s + (Number(r.consumedKwh) || 0), 0);
  const totalBal = totalGen - totalCon;

  const coveragePct = totalCon > 0 ? Math.min(100, (Math.min(totalGen, totalCon) / totalCon) * 100) : 0;
  const currentSurplus = Math.max(0, totalBal);

  // Projection based on elapsed days (assuming 30-day month)
  const daysRecorded = Math.max(1, Math.min(30, readings.length / 24));
  const projectedSurplus = (currentSurplus / daysRecorded) * 30;

  const coverageOnTrack = coveragePct >= goals.targetCoveragePct;
  const surplusOnTrack = projectedSurplus >= goals.targetSurplusKwh;

  return {
    coveragePct: parseFloat(coveragePct.toFixed(1)),
    surplusKwh: parseFloat(currentSurplus.toFixed(1)),
    projectedSurplusKwh: parseFloat(projectedSurplus.toFixed(1)),
    coverageOnTrack,
    surplusOnTrack
  };
}

export function updateGoalsUI(evaluation, goals) {
  const covBar = document.getElementById('goal-cov-bar');
  const covStatus = document.getElementById('goal-cov-status');
  const surplusBar = document.getElementById('goal-surplus-bar');
  const surplusStatus = document.getElementById('goal-surplus-status');

  if (covBar) {
    const pctOfGoal = Math.min(100, (evaluation.coveragePct / goals.targetCoveragePct) * 100);
    covBar.style.width = `${pctOfGoal}%`;
    covBar.className = `progress-bar ${evaluation.coverageOnTrack ? 'surplus' : 'deficit'}`;
  }
  if (covStatus) {
    covStatus.textContent = evaluation.coverageOnTrack ? 'On track' : 'At risk';
    covStatus.style.color = evaluation.coverageOnTrack ? 'var(--surplus)' : 'var(--deficit)';
  }

  if (surplusBar) {
    const pctOfGoal = Math.min(100, (evaluation.surplusKwh / goals.targetSurplusKwh) * 100);
    surplusBar.style.width = `${pctOfGoal}%`;
    surplusBar.className = `progress-bar ${evaluation.surplusOnTrack ? 'surplus' : 'deficit'}`;
  }
  if (surplusStatus) {
    surplusStatus.textContent = evaluation.surplusOnTrack ? 'On track' : 'At risk';
    surplusStatus.style.color = evaluation.surplusOnTrack ? 'var(--surplus)' : 'var(--deficit)';
  }
}

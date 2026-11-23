// Peak-Hours Heatmap: 7x24 Grid of Hourly Energy Balance
// Color scale with colorblind-accessible patterns and labeled legend

export function renderHeatmap(containerId, hourlyReadings) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Initialize 7x24 accumulator
  // matrix[day][hour] = { sumBalance, count, sumGen, sumCon }
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sumBalance: 0, count: 0, sumGen: 0, sumCon: 0 }))
  );

  hourlyReadings.forEach(r => {
    if (!r.periodStart) return;
    const date = new Date(r.periodStart);
    // Convert getDay() (0=Sun, 1=Mon...6=Sat) to Mon=0..Sun=6
    const day = (date.getDay() + 6) % 7;
    const hour = date.getHours();

    const gen = Number(r.generatedKwh) || 0;
    const con = Number(r.consumedKwh) || 0;
    const bal = gen - con;

    matrix[day][hour].sumBalance += bal;
    matrix[day][hour].sumGen += gen;
    matrix[day][hour].sumCon += con;
    matrix[day][hour].count += 1;
  });

  // Find max absolute balance for color scaling
  let maxAbs = 1;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (matrix[d][h].count > 0) {
        const avg = matrix[d][h].sumBalance / matrix[d][h].count;
        if (Math.abs(avg) > maxAbs) maxAbs = Math.abs(avg);
      }
    }
  }

  // Build grid HTML
  let html = `
    <div style="display:grid;grid-template-columns:40px repeat(24, 1fr);gap:3px;align-items:center;">
      <div></div>
  `;

  // Hour headers (0..23)
  for (let h = 0; h < 24; h++) {
    const hrLabel = h % 3 === 0 ? String(h).padStart(2, '0') : '';
    html += `<div style="font-size:9px;font-family:var(--font-mono);color:var(--text-muted);text-align:center;">${hrLabel}</div>`;
  }

  // 7 rows (Mon..Sun)
  for (let d = 0; d < 7; d++) {
    html += `<div style="font-size:10px;font-weight:600;color:var(--text-muted);">${daysOfWeek[d]}</div>`;

    for (let h = 0; h < 24; h++) {
      const cell = matrix[d][h];
      const hasData = cell.count > 0;
      const avgBal = hasData ? cell.sumBalance / cell.count : 0;
      const avgGen = hasData ? cell.sumGen / cell.count : 0;
      const avgCon = hasData ? cell.sumCon / cell.count : 0;

      let bgColor = 'var(--surface-2)';
      let patternMarker = '';
      if (hasData) {
        const ratio = Math.min(Math.abs(avgBal) / maxAbs, 1);
        if (avgBal > 0.05) {
          // Surplus (Solar Yellow / Green)
          bgColor = `rgba(240, 192, 64, ${0.2 + ratio * 0.75})`;
          if (ratio > 0.4) patternMarker = '+';
        } else if (avgBal < -0.05) {
          // Deficit (Deficit Red)
          bgColor = `rgba(248, 81, 73, ${0.2 + ratio * 0.75})`;
          if (ratio > 0.4) patternMarker = '–';
        }
      }

      const tooltipText = hasData
        ? `${daysOfWeek[d]} ${String(h).padStart(2, '0')}:00–${String((h+1)%24).padStart(2, '0')}:00 | Bal: ${avgBal > 0 ? '+' : ''}${avgBal.toFixed(2)} kWh (Gen: ${avgGen.toFixed(2)}, Con: ${avgCon.toFixed(2)})`
        : `${daysOfWeek[d]} ${String(h).padStart(2, '0')}:00 | No data`;

      html += `
        <div class="heatmap-cell"
             title="${tooltipText}"
             tabindex="0"
             role="gridcell"
             aria-label="${tooltipText}"
             style="height:20px;border-radius:2px;background:${bgColor};display:flex;align-items:center;justify-content:center;font-size:9px;font-family:var(--font-mono);color:rgba(0,0,0,0.65);cursor:pointer;border:1px solid rgba(0,0,0,0.1);">
          ${patternMarker}
        </div>
      `;
    }
  }

  html += `</div>`;
  container.innerHTML = html;
}

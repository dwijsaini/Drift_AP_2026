// Zero-dependency SVG Combined Chart: Generation & Consumption Bars + Net Balance Line

export function renderCombinedChart(containerId, readings, options = {}) {
  const svg = document.getElementById(containerId);
  if (!svg) return;

  const tooltip = document.getElementById('chart-tooltip');
  const emptyState = document.getElementById('chart-empty-state');

  if (!readings || readings.length === 0) {
    svg.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    return;
  }
  if (emptyState) emptyState.hidden = true;

  // View bounds
  const width = svg.clientWidth || 800;
  const height = 280;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  const padding = { top: 20, right: 30, bottom: 40, left: 55 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Aggregate or take visible items (up to 24 for daily/weekly, or max 31)
  const data = readings.slice(-24);

  // Calculate scales
  const maxGen = Math.max(...data.map(d => d.generatedKwh || 0), 0);
  const maxCon = Math.max(...data.map(d => d.consumedKwh || 0), 0);
  const maxBarVal = Math.max(maxGen, maxCon, 1);
  const yMax = Math.ceil(maxBarVal * 1.15);

  const balances = data.map(d => (d.generatedKwh || 0) - (d.consumedKwh || 0));
  const minBal = Math.min(...balances, 0);
  const maxBal = Math.max(...balances, 1);
  const balRange = Math.max(Math.abs(minBal), Math.abs(maxBal), 1);

  // SVG Groups
  const gGrid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const gBars = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const gLine = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const gPoints = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const gAxes = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  // Y-axis grid lines (4 ticks)
  for (let i = 0; i <= 4; i++) {
    const yVal = (yMax / 4) * i;
    const yPos = padding.top + chartHeight - (yVal / yMax) * chartHeight;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padding.left);
    line.setAttribute('y1', yPos);
    line.setAttribute('x2', padding.left + chartWidth);
    line.setAttribute('y2', yPos);
    line.setAttribute('stroke', 'var(--border)');
    line.setAttribute('stroke-dasharray', i === 0 ? 'none' : '3,3');
    gGrid.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding.left - 8);
    text.setAttribute('y', yPos + 4);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('font-size', '10px');
    text.setAttribute('font-family', 'var(--font-mono)');
    text.setAttribute('fill', 'var(--text-muted)');
    text.textContent = yVal.toFixed(yMax > 10 ? 0 : 1) + 'k';
    gAxes.appendChild(text);
  }

  // Draw Bars & Collect Line Points
  const barGroupWidth = chartWidth / data.length;
  const barWidth = Math.max(2, Math.min(14, barGroupWidth * 0.35));
  const linePoints = [];

  data.forEach((d, idx) => {
    const xCenter = padding.left + barGroupWidth * (idx + 0.5);
    const genVal = d.generatedKwh || 0;
    const conVal = d.consumedKwh || 0;
    const balVal = genVal - conVal;

    const genH = (genVal / yMax) * chartHeight;
    const conH = (conVal / yMax) * chartHeight;

    // Generation Bar (Solar yellow)
    const genRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    genRect.setAttribute('x', xCenter - barWidth - 1);
    genRect.setAttribute('y', padding.top + chartHeight - genH);
    genRect.setAttribute('width', barWidth);
    genRect.setAttribute('height', Math.max(1, genH));
    genRect.setAttribute('rx', '3');
    genRect.setAttribute('fill', 'var(--solar)');
    genRect.setAttribute('opacity', '0.9');
    gBars.appendChild(genRect);

    // Consumption Bar (Consume blue)
    const conRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    conRect.setAttribute('x', xCenter + 1);
    conRect.setAttribute('y', padding.top + chartHeight - conH);
    conRect.setAttribute('width', barWidth);
    conRect.setAttribute('height', Math.max(1, conH));
    conRect.setAttribute('rx', '3');
    conRect.setAttribute('fill', 'var(--consume)');
    conRect.setAttribute('opacity', '0.85');
    gBars.appendChild(conRect);

    // Balance Point position (mapped around zero center or dual-scale)
    const balNormalized = (balVal / balRange) * 0.45; // scaled to 45% of height
    const balY = padding.top + (chartHeight / 2) - balNormalized * chartHeight;
    linePoints.push({ x: xCenter, y: balY, balVal, d });

    // X-axis date labels (show every few intervals to avoid overlap)
    const step = Math.ceil(data.length / 8);
    if (idx % step === 0 || idx === data.length - 1) {
      const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelText.setAttribute('x', xCenter);
      labelText.setAttribute('y', padding.top + chartHeight + 20);
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('font-size', '10px');
      labelText.setAttribute('font-family', 'var(--font-mono)');
      labelText.setAttribute('fill', 'var(--text-muted)');

      const dateStr = d.periodStart ? String(d.periodStart).slice(5, 10).replace('-', '/') : `${idx + 1}`;
      labelText.textContent = dateStr;
      gAxes.appendChild(labelText);
    }
  });

  // Balance Line (Polyline)
  if (linePoints.length > 1) {
    const pointsStr = linePoints.map(p => `${p.x},${p.y}`).join(' ');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', pointsStr);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'var(--surplus)');
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    gLine.appendChild(polyline);
  }

  // Interactive Hover Targets
  linePoints.forEach(p => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', p.x);
    circle.setAttribute('cy', p.y);
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', p.balVal >= 0 ? 'var(--surplus)' : 'var(--deficit)');
    circle.setAttribute('stroke', 'var(--surface)');
    circle.setAttribute('stroke-width', '2');
    circle.style.cursor = 'pointer';
    circle.style.transition = 'r 0.15s ease';

    // Invisible wide hit target for hover
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitArea.setAttribute('x', p.x - barGroupWidth / 2);
    hitArea.setAttribute('y', padding.top);
    hitArea.setAttribute('width', barGroupWidth);
    hitArea.setAttribute('height', chartHeight);
    hitArea.setAttribute('fill', 'transparent');
    hitArea.style.cursor = 'pointer';

    const showTooltip = (evt) => {
      circle.setAttribute('r', '6');
      if (!tooltip) return;
      const d = p.d;
      const balSign = p.balVal > 0 ? '+' : '';
      const startFmt = String(d.periodStart || '').replace('T', ' ');
      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid var(--border-muted);padding-bottom:2px;">
          ${startFmt}
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;">
          <span style="color:var(--solar)">Generated:</span>
          <span class="mono">${(d.generatedKwh || 0).toFixed(2)} kWh</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;">
          <span style="color:var(--consume)">Consumed:</span>
          <span class="mono">${(d.consumedKwh || 0).toFixed(2)} kWh</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;margin-top:2px;font-weight:bold;color:${p.balVal >= 0 ? 'var(--surplus)' : 'var(--deficit)'}">
          <span>Balance:</span>
          <span class="mono">${balSign}${p.balVal.toFixed(2)} kWh</span>
        </div>
      `;
      tooltip.style.opacity = '1';
      tooltip.style.left = `${Math.min(p.x, width - 160)}px`;
      tooltip.style.top = `${Math.max(10, p.y - 80)}px`;
    };

    const hideTooltip = () => {
      circle.setAttribute('r', '4');
      if (tooltip) tooltip.style.opacity = '0';
    };

    hitArea.addEventListener('mouseenter', showTooltip);
    hitArea.addEventListener('mouseleave', hideTooltip);
    circle.addEventListener('mouseenter', showTooltip);
    circle.addEventListener('mouseleave', hideTooltip);

    gPoints.appendChild(circle);
    gPoints.appendChild(hitArea);
  });

  svg.appendChild(gGrid);
  svg.appendChild(gBars);
  svg.appendChild(gLine);
  svg.appendChild(gPoints);
  svg.appendChild(gAxes);
}

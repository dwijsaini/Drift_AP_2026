// Tiered Tariff Calculator & Slab Manager
// User-editable slab table with flat-rate alternative
// Explicitly labeled: "example slabs, edit to match your DISCOM bill"

export function calculateSlabCost(gridImportKwh, slabs) {
  if (!gridImportKwh || gridImportKwh <= 0) return 0;
  let remaining = gridImportKwh;
  let totalCost = 0;

  for (const slab of slabs) {
    if (remaining <= 0) break;
    const slabSpan = slab.to !== null ? slab.to - slab.from + 1 : Infinity;
    const unitsInSlab = Math.min(remaining, slabSpan);
    totalCost += unitsInSlab * slab.rate;
    remaining -= unitsInSlab;
  }

  return totalCost;
}

export function renderSlabTable(containerId, slabs, onSlabChange) {
  const tbody = document.getElementById(containerId);
  if (!tbody) return;

  tbody.innerHTML = slabs.map((slab, index) => `
    <tr>
      <td class="mono">${slab.from}</td>
      <td>
        <input type="number" class="slab-to-input mono" data-idx="${index}" value="${slab.to ?? ''}" placeholder="Above"
               style="width:70px;padding:2px 4px;background:var(--surface-2);border:1px solid var(--border-muted);color:var(--text);border-radius:3px;">
      </td>
      <td>
        <input type="number" step="0.05" class="slab-rate-input mono" data-idx="${index}" value="${slab.rate}"
               style="width:70px;padding:2px 4px;background:var(--surface-2);border:1px solid var(--border-muted);color:var(--text);border-radius:3px;">
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.slab-to-input, .slab-rate-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = Number(input.dataset.idx);
      const toVal = tbody.querySelector(`.slab-to-input[data-idx="${idx}"]`).value.trim();
      const rateVal = tbody.querySelector(`.slab-rate-input[data-idx="${idx}"]`).value.trim();

      slabs[idx].to = toVal === '' ? null : Number(toVal);
      slabs[idx].rate = Number(rateVal) || 0;
      if (onSlabChange) onSlabChange(slabs);
    });
  });
}

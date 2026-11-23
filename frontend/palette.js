// Command Palette (Cmd+K / Ctrl+K) for Drift
// Quick actions, building switching, section navigation, and shortcuts help

export function initCommandPalette(actions = {}) {
  const modal = document.getElementById('modal-palette');
  const input = document.getElementById('palette-search-input');
  const list = document.getElementById('palette-list');
  const triggerBtn = document.getElementById('btn-command-palette');

  if (!modal || !input || !list) return;

  function openPalette() {
    modal.classList.add('open');
    input.value = '';
    renderItems('');
    setTimeout(() => input.focus(), 50);
  }

  function closePalette() {
    modal.classList.remove('open');
  }

  triggerBtn?.addEventListener('click', openPalette);

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.classList.contains('open')) closePalette();
      else openPalette();
    } else if (e.key === 'Escape' && modal.classList.contains('open')) {
      closePalette();
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePalette();
  });

  const defaultCommands = [
    { title: 'Dashboard', desc: 'Jump to main overview & stat cards', category: 'Navigation', run: () => actions.navigate('dashboard') },
    { title: 'Readings Table', desc: 'Jump to granular interval table', category: 'Navigation', run: () => actions.navigate('readings-section') },
    { title: 'Trends & Charts', desc: 'Jump to energy story chart', category: 'Navigation', run: () => actions.navigate('trends-section') },
    { title: 'Peak-Hours Heatmap', desc: 'View 7x24 solar balance grid', category: 'Navigation', run: () => actions.navigate('heatmap-panel') },
    { title: 'Tariff Calculator', desc: 'Configure tiered slab rates', category: 'Navigation', run: () => actions.navigate('cost-section') },
    { title: 'Building Comparison', desc: 'Compare all accessible sites', category: 'Navigation', run: () => actions.navigate('compare-section') },
    { title: 'Goals & Targets', desc: 'View coverage & surplus progress', category: 'Navigation', run: () => actions.navigate('goals-section') },
    { title: 'Toggle Theme', desc: 'Switch between Dark and Light mode', category: 'Settings', run: () => actions.toggleTheme() },
    { title: 'Toggle API / Preview Mode', desc: 'Switch data mode', category: 'Mode', run: () => actions.toggleMode() },
    { title: 'Load Demo Data', desc: 'Fill realistic weather-varied preview data', category: 'Data', run: () => actions.loadDemoData() },
    { title: 'Export CSV', desc: 'Download interval readings with column chooser', category: 'Data', run: () => actions.openExportModal() },
    { title: 'Import CSV', desc: 'Upload interval readings', category: 'Data', run: () => actions.openImportModal() },
    { title: 'Print Weekly Report', desc: 'Generate 1-page printable summary', category: 'Report', run: () => actions.printReport() },
    { title: 'Add Reading (+)', desc: 'Log a new interval reading', category: 'Action', run: () => actions.openAddReading() }
  ];

  function getCombinedCommands() {
    const buildingCommands = (actions.getBuildings ? actions.getBuildings() : []).map(b => ({
      title: `Switch Building: ${b.name}`,
      desc: `Switch active site to ${b.name} (${b.timezone || 'UTC'})`,
      category: 'Buildings',
      run: () => actions.selectBuilding(b.buildingId)
    }));
    return [...buildingCommands, ...defaultCommands];
  }

  function renderItems(filterText) {
    const term = filterText.toLowerCase().trim();
    const all = getCombinedCommands();
    const filtered = term
      ? all.filter(c => c.title.toLowerCase().includes(term) || c.desc.toLowerCase().includes(term) || c.category.toLowerCase().includes(term))
      : all;

    if (filtered.length === 0) {
      list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No matching commands found.</div>`;
      return;
    }

    list.innerHTML = filtered.map((cmd, idx) => `
      <div class="palette-item" data-idx="${idx}" tabindex="0" role="option"
           style="padding:8px 12px;border-radius:var(--radius-control);display:flex;justify-content:space-between;align-items:center;cursor:pointer;transition:background 0.1s ease;">
        <div>
          <div style="font-size:0.88rem;font-weight:600;color:var(--text);">${cmd.title}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${cmd.desc}</div>
        </div>
        <span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:var(--border);color:var(--text-dim);font-weight:500;">${cmd.category}</span>
      </div>
    `).join('');

    list.querySelectorAll('.palette-item').forEach((el, idx) => {
      el.addEventListener('mouseenter', () => el.style.background = 'var(--surface-hover)');
      el.addEventListener('mouseleave', () => el.style.background = 'none');
      el.addEventListener('click', () => {
        closePalette();
        filtered[idx].run();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          closePalette();
          filtered[idx].run();
        }
      });
    });
  }

  input.addEventListener('input', (e) => renderItems(e.target.value));
}

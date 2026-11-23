// Notification Center Manager
// Monitors missing hours, coverage drop vs last week, deficit days, and goal status
// Supports read/unread state and persistence

const NOTIF_STORAGE_KEY = 'drift.read-notifications';

export function evaluateNotifications(readings, goalsEvaluation, buildingName = 'Building') {
  const notifs = [];
  const readIds = new Set(JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY) || '[]'));

  if (!readings || readings.length === 0) {
    return { list: [], unreadCount: 0 };
  }

  // 1. Missing hours check
  const missingHours = readings.reduce((s, r) => s + (Number(r.missingPeriodCount) || 0), 0);
  if (missingHours > 0) {
    notifs.push({
      id: `gap-${missingHours}`,
      type: 'warning',
      title: 'Telemetry Gaps Detected',
      message: `${missingHours} expected hourly interval readings are missing in ${buildingName}.`,
      time: 'Recent'
    });
  }

  // 2. High deficit days check
  const deficitDays = readings.filter(r => (Number(r.consumedKwh) || 0) > (Number(r.generatedKwh) || 0));
  if (deficitDays.length > 0) {
    notifs.push({
      id: `deficit-${deficitDays.length}`,
      type: 'info',
      title: 'Deficit Intervals Recorded',
      message: `Consumption exceeded solar production during ${deficitDays.length} recorded intervals.`,
      time: 'Summary'
    });
  }

  // 3. Goal status check
  if (goalsEvaluation) {
    if (goalsEvaluation.coverageOnTrack) {
      notifs.push({
        id: 'goal-cov-hit',
        type: 'success',
        title: 'Coverage Target Achieved',
        message: `Current solar coverage is ${goalsEvaluation.coveragePct}%, exceeding your target.`,
        time: 'Goal'
      });
    } else {
      notifs.push({
        id: 'goal-cov-risk',
        type: 'warning',
        title: 'Coverage Target At Risk',
        message: `Current coverage is ${goalsEvaluation.coveragePct}%, below the configured threshold.`,
        time: 'Goal'
      });
    }
  }

  const list = notifs.map(n => ({ ...n, read: readIds.has(n.id) }));
  const unreadCount = list.filter(n => !n.read).length;

  return { list, unreadCount };
}

export function initNotificationsUI(notifsData, onMarkRead) {
  const badge = document.getElementById('unread-count');
  const panel = document.getElementById('notifications-panel');
  const listEl = document.getElementById('notifications-list');
  const bellBtn = document.getElementById('btn-notifications');
  const closeBtn = document.getElementById('btn-close-notif');
  const markAllBtn = document.getElementById('btn-mark-all-read');

  if (badge) {
    badge.textContent = notifsData.unreadCount;
    badge.hidden = notifsData.unreadCount === 0;
  }

  function openPanel() {
    panel?.classList.add('open');
    renderList();
  }

  function closePanel() {
    panel?.classList.remove('open');
  }

  bellBtn?.addEventListener('click', () => {
    if (panel?.classList.contains('open')) closePanel();
    else openPanel();
  });

  closeBtn?.addEventListener('click', closePanel);
  panel?.addEventListener('click', (e) => {
    if (e.target === panel) closePanel();
  });

  markAllBtn?.addEventListener('click', () => {
    const readIds = notifsData.list.map(n => n.id);
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(readIds));
    notifsData.list.forEach(n => n.read = true);
    notifsData.unreadCount = 0;
    if (badge) badge.hidden = true;
    renderList();
    if (onMarkRead) onMarkRead();
  });

  function renderList() {
    if (!listEl) return;
    if (notifsData.list.length === 0) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No new notifications. Everything is running smoothly.</div>`;
      return;
    }

    listEl.innerHTML = notifsData.list.map(item => `
      <div style="padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-control);border-left:3px solid ${item.type === 'success' ? 'var(--surplus)' : item.type === 'warning' ? 'var(--solar)' : 'var(--consume)'};opacity:${item.read ? 0.65 : 1};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
          <strong style="font-size:0.85rem;color:var(--text);">${item.title}</strong>
          <span style="font-size:0.7rem;color:var(--text-dim);">${item.time}</span>
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);margin:0;">${item.message}</p>
      </div>
    `).join('');
  }
}

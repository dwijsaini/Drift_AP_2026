/**
 * Generates interactive HTML documentation for Drift REST API endpoints.
 * Serves /docs route in Express.
 */

export const apiEndpoints = [
  {
    method: 'GET',
    path: '/health',
    access: 'Public',
    description: 'Verifies HTTP server status and PostgreSQL database connection.',
    params: [],
    requestBody: null,
    responseExample: { status: 'ok', database: 'ok' }
  },
  {
    method: 'GET',
    path: '/api/buildings',
    access: 'Member',
    description: 'Lists all buildings accessible to the authenticated caller with assigned membership roles.',
    headers: [{ name: 'X-User-Id', required: true, description: 'Development user identity ID' }],
    params: [],
    requestBody: null,
    responseExample: {
      data: [
        {
          buildingId: "1",
          name: "Drift Demo Home",
          address: "1 Solar Lane, Bengaluru",
          timezone: "Asia/Kolkata",
          createdAt: "2026-11-21T05:14:16.400Z",
          role: "OWNER"
        }
      ]
    }
  },
  {
    method: 'POST',
    path: '/api/buildings',
    access: 'Signed-in user',
    description: 'Creates a new building and automatically assigns caller as OWNER.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [],
    requestBody: {
      name: "Rooftop Solar Villa",
      address: "42 Sunshine Road, Bengaluru",
      timezone: "Asia/Kolkata"
    },
    responseExample: {
      data: {
        buildingId: "3",
        name: "Rooftop Solar Villa",
        address: "42 Sunshine Road, Bengaluru",
        timezone: "Asia/Kolkata",
        createdAt: "2026-11-23T16:00:00.000Z"
      }
    }
  },
  {
    method: 'GET',
    path: '/api/buildings/:buildingId/readings',
    access: 'Member (OWNER, EDITOR, VIEWER)',
    description: 'Lists interval readings chronologically with pagination, date filtering, and column sorting.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [
      { name: 'from', type: 'ISO 8601 string', optional: true, description: 'Start timestamp (inclusive)' },
      { name: 'to', type: 'ISO 8601 string', optional: true, description: 'End timestamp (exclusive)' },
      { name: 'page', type: 'integer', optional: true, description: 'Page number (default 1)' },
      { name: 'pageSize', type: 'integer', optional: true, description: 'Items per page (max 10000)' },
      { name: 'sortBy', type: 'string', optional: true, description: 'Sort field: periodStart | generatedKwh | consumedKwh' },
      { name: 'sortDir', type: 'string', optional: true, description: 'Sort direction: asc | desc' }
    ],
    requestBody: null,
    responseExample: {
      data: [
        {
          readingId: "101",
          buildingId: "1",
          periodStart: "2026-10-01T04:30:00.000Z",
          periodEnd: "2026-10-01T05:30:00.000Z",
          generatedKwh: "3.850",
          consumedKwh: "1.200",
          gridImportKwh: "0.000",
          batteryChargeKwh: "1.855",
          batteryDischargeKwh: "0.000",
          source: "API"
        }
      ],
      pagination: { total: 90, page: 1, pageSize: 20, totalPages: 5 }
    }
  },
  {
    method: 'POST',
    path: '/api/buildings/:buildingId/readings',
    access: 'OWNER, EDITOR',
    description: 'Records a new interval reading for a building. Checks for interval ordering and collision.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [],
    requestBody: {
      periodStart: "2026-10-01T10:00:00+05:30",
      periodEnd: "2026-10-01T11:00:00+05:30",
      generatedKwh: 4.25,
      consumedKwh: 2.10,
      gridImportKwh: 0,
      source: "MANUAL"
    },
    responseExample: {
      data: {
        readingId: "181",
        buildingId: "1",
        periodStart: "2026-10-01T04:30:00.000Z",
        periodEnd: "2026-10-01T05:30:00.000Z",
        generatedKwh: "4.250",
        consumedKwh: "2.100",
        gridImportKwh: "0.000",
        source: "MANUAL"
      }
    }
  },
  {
    method: 'PATCH',
    path: '/api/buildings/:buildingId/readings/:readingId',
    access: 'OWNER, EDITOR',
    description: 'Partially updates an existing interval reading.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [],
    requestBody: { generatedKwh: 4.8 },
    responseExample: {
      data: {
        readingId: "181",
        generatedKwh: "4.800"
      }
    }
  },
  {
    method: 'DELETE',
    path: '/api/buildings/:buildingId/readings/:readingId',
    access: 'OWNER, EDITOR',
    description: 'Permanently deletes an interval reading.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [],
    requestBody: null,
    responseExample: null
  },
  {
    method: 'GET',
    path: '/api/buildings/:buildingId/summaries/:granularity',
    access: 'Member',
    description: 'Retrieves calendar-aligned energy balance, coverage percentage, completeness, and estimated cost metrics.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [
      { name: 'granularity', type: 'path', description: 'daily | weekly | monthly' },
      { name: 'from', type: 'query (ISO 8601)', required: true, description: 'Start range' },
      { name: 'to', type: 'query (ISO 8601)', required: true, description: 'End range' },
      { name: 'electricityRateInrPerKwh', type: 'query (number)', optional: true, description: 'Rate for INR grid cost estimate' }
    ],
    requestBody: null,
    responseExample: {
      data: [
        {
          periodStart: "2026-10-01",
          periodEnd: "2026-10-02",
          timezone: "Asia/Kolkata",
          generatedKwh: "34.820",
          consumedKwh: "28.450",
          energyBalanceKwh: "6.370",
          energyGapKwh: "-6.370",
          solarCoveragePct: 100,
          readingCount: 24,
          expectedReadingCount: 24,
          missingPeriodCount: 0,
          hasGap: false,
          estimatedGridCostInr: "124.50",
          estimatedGridCostLabel: "Estimate from recorded grid import only; not a utility bill."
        }
      ]
    }
  },
  {
    method: 'GET',
    path: '/api/buildings/comparison',
    access: 'Member',
    description: 'Compares energy metrics across all accessible buildings for a given time window.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [
      { name: 'from', type: 'query (ISO 8601)', required: true, description: 'Start timestamp' },
      { name: 'to', type: 'query (ISO 8601)', required: true, description: 'End timestamp' },
      { name: 'electricityRateInrPerKwh', type: 'query (number)', optional: true, description: 'Electricity tariff rate' }
    ],
    requestBody: null,
    responseExample: {
      data: [
        {
          buildingId: "1",
          buildingName: "Drift Demo Home",
          timezone: "Asia/Kolkata",
          generatedKwh: "128.400",
          consumedKwh: "95.200",
          energyBalanceKwh: "33.200",
          solarCoveragePct: 91.5,
          readingCount: 90,
          expectedReadingCount: 90,
          missingPeriodCount: 0,
          hasGap: false
        }
      ]
    }
  },
  {
    method: 'GET',
    path: '/api/buildings/:buildingId/readings.csv',
    access: 'Member',
    description: 'Exports building readings as downloadable CSV with optional date-range filter and column chooser.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [
      { name: 'from', type: 'ISO 8601 string', optional: true, description: 'Start date' },
      { name: 'to', type: 'ISO 8601 string', optional: true, description: 'End date' },
      { name: 'columns', type: 'string', optional: true, description: 'Comma-separated columns to include' }
    ],
    requestBody: null,
    responseExample: "periodStart,periodEnd,generatedKwh,consumedKwh,gridImportKwh,source\n2026-10-01T04:30:00.000Z,2026-10-01T05:30:00.000Z,3.850,1.200,0.000,API"
  },
  {
    method: 'POST',
    path: '/api/buildings/:buildingId/readings.csv',
    access: 'OWNER, EDITOR',
    description: 'Bulk imports readings via CSV text atomically using batch insertion.',
    headers: [{ name: 'X-User-Id', required: true, description: 'User ID' }],
    params: [],
    requestBody: { csv: "periodStart,periodEnd,generatedKwh,consumedKwh...\n..." },
    responseExample: { data: { imported: 24 } }
  }
];

export function renderDocsHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drift API Documentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-2: #1f2733;
      --border: #21262d;
      --text: #e6edf3;
      --text-muted: #7d8590;
      --solar: #f0c040;
      --consume: #58a6ff;
      --surplus: #3fb950;
      --deficit: #f85149;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      padding: 32px 20px;
      line-height: 1.6;
    }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 4px; display: flex; align-items: center; gap: 10px; }
    .mark { background: var(--solar); color: #000; width: 32px; height: 32px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; }
    .subtitle { color: var(--text-muted); margin-bottom: 32px; font-size: 0.95rem; }
    .endpoint-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 20px;
      padding: 20px;
    }
    .endpoint-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .badge {
      font-family: 'DM Mono', monospace;
      font-weight: 700;
      font-size: 0.8rem;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .badge.GET { background: rgba(88, 166, 255, 0.2); color: var(--consume); }
    .badge.POST { background: rgba(63, 185, 80, 0.2); color: var(--surplus); }
    .badge.PATCH { background: rgba(240, 192, 64, 0.2); color: var(--solar); }
    .badge.DELETE { background: rgba(248, 81, 73, 0.2); color: var(--deficit); }
    .path { font-family: 'DM Mono', monospace; font-size: 1rem; font-weight: 600; }
    .access-tag { margin-left: auto; font-size: 0.75rem; background: var(--surface-2); padding: 2px 8px; border-radius: 4px; color: var(--text-muted); }
    .desc { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 12px; }
    pre {
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'DM Mono', monospace;
      font-size: 0.82rem;
      color: #79c0ff;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 12px 0; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); }
    a { color: var(--solar); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h1><span class="mark">☼</span> Drift API Reference</h1>
      <a href="/">← Return to Dashboard</a>
    </div>
    <p class="subtitle">Complete REST endpoint specification, parameters, role-based authorization requirements, and example payloads.</p>

    <div style="margin-bottom:24px;padding:14px;background:var(--surface);border-left:4px solid var(--solar);border-radius:4px;font-size:0.85rem;">
      <strong>Authentication Notice:</strong> The <code>X-User-Id</code> header is a development identity mechanism for this class project, not production auth. All requests to <code>/api/*</code> must pass a valid user ID.
    </div>

    ${apiEndpoints.map(ep => `
      <article class="endpoint-card">
        <div class="endpoint-header">
          <span class="badge ${ep.method}">${ep.method}</span>
          <span class="path">${ep.path}</span>
          <span class="access-tag">${ep.access}</span>
        </div>
        <p class="desc">${ep.description}</p>
        
        ${ep.params && ep.params.length > 0 ? `
          <div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-top:8px;">Parameters:</div>
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              ${ep.params.map(p => `<tr><td><code>${p.name}</code></td><td>${p.type || 'string'}</td><td>${p.description}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : ''}

        ${ep.requestBody ? `
          <div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-top:8px;">Example Request Body:</div>
          <pre>${JSON.stringify(ep.requestBody, null, 2)}</pre>
        ` : ''}

        ${ep.responseExample ? `
          <div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-top:8px;">Example Response:</div>
          <pre>${typeof ep.responseExample === 'string' ? ep.responseExample : JSON.stringify(ep.responseExample, null, 2)}</pre>
        ` : ''}
      </article>
    `).join('')}
  </div>
</body>
</html>`;
}

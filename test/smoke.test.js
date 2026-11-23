import test from 'node:test';
import assert from 'node:assert/strict';

test('Smoke test: static assets and API routes return 200', async () => {
  const baseUrl = 'http://localhost:3000';

  // 1. Root dashboard HTML
  const rootRes = await fetch(`${baseUrl}/`);
  assert.equal(rootRes.status, 200);
  const rootHtml = await rootRes.text();
  assert.ok(rootHtml.includes('<!doctype html>'));
  assert.ok(rootHtml.includes('Drift'));
  assert.ok(rootHtml.includes('styles.css'));
  assert.ok(rootHtml.includes('app.js'));

  // 2. Health check
  const healthRes = await fetch(`${baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.status, 'ok');
  assert.equal(healthJson.database, 'ok');

  // 3. API Docs
  const docsRes = await fetch(`${baseUrl}/docs`);
  assert.equal(docsRes.status, 200);
  const docsHtml = await docsRes.text();
  assert.ok(docsHtml.includes('Drift API Reference'));
  assert.ok(docsHtml.includes('/api/buildings'));

  // 4. CSS and JS Modules
  const cssRes = await fetch(`${baseUrl}/styles.css`);
  assert.equal(cssRes.status, 200);
  const css = await cssRes.text();
  assert.ok(css.includes('--solar: #f0c040'));
  assert.ok(css.includes('[data-theme="light"]'));

  for (const module of ['app.js', 'chart.js', 'heatmap.js', 'tariff.js', 'goals.js', 'insights.js', 'palette.js', 'notifications.js']) {
    const res = await fetch(`${baseUrl}/${module}`);
    assert.equal(res.status, 200, `Module ${module} should return 200`);
  }
});

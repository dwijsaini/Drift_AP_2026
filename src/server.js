import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './db.js';
import { renderDocsHtml } from './docsHtml.js';
import { errorMiddleware } from './http.js';
import { router } from './routes.js';

const app = express();
app.set('json replacer', (_key, value) => typeof value === 'bigint' ? value.toString() : value);
app.use(express.json({ limit: '2mb' }));
app.get('/health', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok' });
  } catch (error) { next(error); }
});
app.get('/docs', (_req, res) => {
  res.type('html').send(renderDocsHtml());
});
app.use('/api', router);
const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
app.use(express.static(frontendDirectory));
app.use((req, res) => res.status(404).json({ error: { message: 'Route not found' } }));
app.use(errorMiddleware);

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`Drift API listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => { await prisma.$disconnect(); process.exit(0); }));
}

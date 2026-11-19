import 'dotenv/config';
import express from 'express';
import { prisma } from './db.js';
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
app.use('/api', router);
app.use((req, res) => res.status(404).json({ error: { message: 'Route not found' } }));
app.use(errorMiddleware);

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`Drift API listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => { await prisma.$disconnect(); process.exit(0); }));
}

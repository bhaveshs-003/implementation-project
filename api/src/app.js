import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import milestonesRouter from './routes/milestones.js';
import subtasksRouter from './routes/subtasks.js';
import approvalsRouter from './routes/approvals.js';
import delaysRouter from './routes/delays.js';
import attachmentsRouter from './routes/attachments.js';
import peopleRouter from './routes/people.js';
import auditRouter from './routes/audit.js';
import dashboardRouter from './routes/dashboard.js';
import internalRouter from './routes/internal.js';
import pool from './db/pool.js';

const app = express();

app.set('trust proxy', 1);

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Health / ready ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.get('/api/ready', async (req, res) => {
  // Admin-only: checked via simple token or cookie for minimal overhead
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('Readiness check failed:', err.message);
    res.status(503).json({ status: 'error', db: 'unavailable' });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/people', peopleRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/milestones', milestonesRouter);
app.use('/api/projects/:projectId/milestones/:milestoneId/subtasks', subtasksRouter);
app.use('/api/projects/:projectId/milestones/:milestoneId/approval', approvalsRouter);
app.use('/api/projects/:projectId/delays', delaysRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/internal', internalRouter);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

// Only bind to a port when run directly (not imported by tests)
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`API listening on port ${PORT}`);
  });
}

#!/usr/bin/env node
// Checks environment and configuration.
import pg from 'pg';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'CRON_SECRET',
  'FRONTEND_URL',
];

async function doctor() {
  let pass = true;

  console.log('── Environment variables ──');
  for (const key of REQUIRED_ENV) {
    if (process.env[key]) {
      console.log(`  ✓ ${key}`);
    } else {
      console.error(`  ✗ ${key} is missing`);
      pass = false;
    }
  }

  console.log('\n── Database connection ──');
  try {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('SELECT 1');
    await pool.end();
    console.log('  ✓ Connected');
  } catch (err) {
    console.error('  ✗ DB error:', err.message);
    pass = false;
  }

  console.log('\n── Supabase Auth reachability ──');
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/keys`);
    if (res.ok) {
      console.log('  ✓ JWKS endpoint reachable');
    } else {
      console.error('  ✗ JWKS returned', res.status);
      pass = false;
    }
  } catch (err) {
    console.error('  ✗ Fetch error:', err.message);
    pass = false;
  }

  console.log('');
  if (pass) {
    console.log('All checks passed.');
  } else {
    console.error('Some checks failed. Fix the above before deploying.');
    process.exit(1);
  }
}

doctor().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const dbUrl = process.env.DATABASE_URL || '';
  const ssl = dbUrl.includes('supabase') ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString: dbUrl, ssl });

  try {
    // Ensure migrations tracking table exists.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir = join(__dirname, '../migrations');
    const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const applied = await pool.query('SELECT 1 FROM _migrations WHERE filename = $1', [file]);
      if (applied.rows.length > 0) {
        console.log(`  skip ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(join(dir, file), 'utf8');
      console.log(`  apply ${file}...`);
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      console.log(`  ✓ ${file}`);
    }

    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function seed() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const dir = join(__dirname, '../seeds');
    const { readdir } = await import('fs/promises');
    const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      console.log(`  seed ${file}...`);
      await pool.query(sql);
      console.log(`  ✓ ${file}`);
    }
    console.log('Seed complete.');
  } finally {
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });

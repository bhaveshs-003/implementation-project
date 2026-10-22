#!/usr/bin/env node
// Provisions the 'attachments' bucket in Supabase Storage.

async function setupStorage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
    process.exit(1);
  }

  // Check if bucket exists.
  const listRes = await fetch(`${url}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  const buckets = await listRes.json();

  const exists = Array.isArray(buckets) && buckets.some(b => b.id === 'attachments');

  if (exists) {
    console.log('Bucket "attachments" already exists.');
    return;
  }

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: 'attachments',
      name: 'attachments',
      public: false,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/png',
        'image/jpeg',
      ],
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    console.error('Failed to create bucket:', body);
    process.exit(1);
  }

  console.log('Bucket "attachments" created (private, 10MB limit).');
}

setupStorage().catch(err => { console.error(err); process.exit(1); });

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg'];

const EXTENSION_MIME_MAP = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function getExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function supabaseHeaders() {
  return {
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// POST /upload-url
// Returns a short-lived signed URL for a direct browser → Supabase Storage upload
router.post('/upload-url', requireAuth, async (req, res) => {
  try {
    const { filename, project_id } = req.body;

    if (!filename || typeof filename !== 'string' || !filename.trim()) {
      return res.status(422).json({ error: 'filename is required' });
    }
    if (!project_id) {
      return res.status(422).json({ error: 'project_id is required' });
    }

    const ext = getExtension(filename.trim());
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(422).json({
        error: `File type '.${ext}' is not allowed. Permitted: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }

    // Derive MIME server-side — never trust the client's Content-Type
    const mimeType = EXTENSION_MIME_MAP[ext];

    // Verify caller has access to the project
    if (req.person.role === 'admin') {
      const projectResult = await query(
        'SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL',
        [project_id]
      );
      if (!projectResult.rows.length) {
        return res.status(404).json({ error: 'Project not found' });
      }
    } else {
      // Partner must be POC on the project to upload
      const pocResult = await query(
        "SELECT COUNT(*) FROM project_assignments WHERE project_id = $1 AND person_id = $2 AND assignment_role = 'poc'",
        [project_id, req.person.id]
      );
      if (parseInt(pocResult.rows[0].count, 10) === 0) {
        return res.status(403).json({ error: 'Access denied to this project' });
      }
    }

    const uuid = randomUUID();
    const supabaseUrl = process.env.SUPABASE_URL;

    // Request a signed upload URL from Supabase Storage
    const signResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/attachments/${uuid}`,
      {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify({ expiresIn: 300 }),
      }
    );

    if (!signResponse.ok) {
      const text = await signResponse.text();
      console.error('Supabase signed upload URL error:', text);
      return res.status(502).json({ error: 'Failed to generate upload URL' });
    }

    const signData = await signResponse.json();
    // Supabase returns { signedURL, token, url, path }
    const uploadUrl = signData.signedURL ?? signData.url;

    // Record the attachment before the upload happens (claimed=false marks it as pending)
    await query(
      `INSERT INTO attachments (id, storage_path, original_name, mime_type, claimed, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [uuid, uuid, filename.trim(), mimeType, req.person.id]
    );

    return res.status(201).json({
      attachment_id: uuid,
      upload_url: uploadUrl,
      expires_in: 300,
    });
  } catch (err) {
    console.error('POST /upload-url error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:attachmentId/claim
// Called after the client finishes uploading to confirm file size and MIME from storage
router.post('/:attachmentId/claim', requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params;

    const attachmentResult = await query(
      'SELECT * FROM attachments WHERE id = $1 AND created_by = $2 AND claimed = false',
      [attachmentId, req.person.id]
    );
    if (!attachmentResult.rows.length) {
      return res.status(404).json({ error: 'Attachment not found or already claimed' });
    }
    const attachment = attachmentResult.rows[0];

    const supabaseUrl = process.env.SUPABASE_URL;

    // HEAD the object to get actual file size from storage
    const headResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/attachments/${attachment.storage_path}`,
      {
        method: 'HEAD',
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!headResponse.ok) {
      return res.status(502).json({ error: 'Failed to verify file in storage' });
    }

    const sizeBytes = parseInt(headResponse.headers.get('content-length') || '0', 10);

    if (sizeBytes > 10 * 1024 * 1024) {
      // Clean up the DB record — storage object can be swept by cron
      await query('DELETE FROM attachments WHERE id = $1', [attachmentId]);
      return res.status(422).json({ error: 'File exceeds the 10 MB size limit' });
    }

    // Re-derive MIME from the original filename extension (never use Content-Type header)
    const ext = getExtension(attachment.original_name);
    const mimeType = EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';

    await query(
      'UPDATE attachments SET size_bytes = $1, mime_type = $2 WHERE id = $3',
      [sizeBytes, mimeType, attachmentId]
    );

    const updated = await query(
      'SELECT id, original_name, mime_type, size_bytes FROM attachments WHERE id = $1',
      [attachmentId]
    );

    return res.json(updated.rows[0]);
  } catch (err) {
    console.error('POST /:attachmentId/claim error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:attachmentId/download
// Returns a 60-second signed download URL that forces a browser download
router.get('/:attachmentId/download', requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params;

    // Fetch attachment and its linked delay_id (if it belongs to a message)
    const attachmentResult = await query(
      `SELECT a.*, dm.delay_id
       FROM attachments a
       LEFT JOIN delay_messages dm ON dm.attachment_id = a.id
       WHERE a.id = $1`,
      [attachmentId]
    );
    if (!attachmentResult.rows.length) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    const attachment = attachmentResult.rows[0];

    // Verify the caller can access the project this attachment belongs to
    if (attachment.delay_id) {
      const delayResult = await query(
        `SELECT m.project_id
         FROM delays d
         JOIN milestones m ON m.id = d.milestone_id
         WHERE d.id = $1`,
        [attachment.delay_id]
      );
      if (!delayResult.rows.length) {
        return res.status(404).json({ error: 'Associated project not found' });
      }
      const projectId = delayResult.rows[0].project_id;

      if (req.person.role !== 'admin') {
        const assignmentResult = await query(
          'SELECT COUNT(*) FROM project_assignments WHERE project_id = $1 AND person_id = $2',
          [projectId, req.person.id]
        );
        if (parseInt(assignmentResult.rows[0].count, 10) === 0) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    } else if (req.person.role !== 'admin') {
      // Attachment not yet linked to any message — only admin can retrieve
      return res.status(403).json({ error: 'Access denied' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;

    const signResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/sign/attachments/${attachment.storage_path}`,
      {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify({ expiresIn: 60, contentDisposition: 'attachment' }),
      }
    );

    if (!signResponse.ok) {
      const text = await signResponse.text();
      console.error('Supabase signed download URL error:', text);
      return res.status(502).json({ error: 'Failed to generate download URL' });
    }

    const signData = await signResponse.json();
    const downloadUrl = signData.signedURL ?? signData.signedUrl ?? signData.url;

    return res.json({ url: downloadUrl });
  } catch (err) {
    console.error('GET /:attachmentId/download error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

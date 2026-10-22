import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { query } from '../db/pool.js';
import { pruneRateLimits } from '../middleware/rateLimit.js';

const router = Router();

// POST /cron
// Base: /api/internal/cron
// Auth: Authorization: Bearer <CRON_SECRET> header (no cookie)
router.post('/cron', async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET || '';

    // Reject if the secret is not configured — misconfiguration is a security risk
    if (!cronSecret) {
      return res.status(500).json({ error: 'CRON_SECRET is not configured' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    let authorized = false;
    try {
      const tokenBuf = Buffer.from(token);
      const secretBuf = Buffer.from(cronSecret);
      // timingSafeEqual requires equal-length buffers
      authorized =
        tokenBuf.length === secretBuf.length &&
        timingSafeEqual(tokenBuf, secretBuf);
    } catch {
      authorized = false;
    }

    if (!authorized) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    // ── Task 1: Delete unclaimed attachments older than 1 hour ──────────────
    const staleResult = await query(
      "SELECT id, storage_path FROM attachments WHERE claimed = false AND created_at < NOW() - INTERVAL '1 hour'"
    );

    let cleanedAttachments = 0;
    for (const attachment of staleResult.rows) {
      // Best-effort storage deletion — log but do not abort on failure
      try {
        const deleteResponse = await fetch(
          `${supabaseUrl}/storage/v1/object/attachments/${attachment.storage_path}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
          }
        );
        if (!deleteResponse.ok) {
          console.warn(
            `Storage DELETE for ${attachment.storage_path} returned ${deleteResponse.status}`
          );
        }
      } catch (storageErr) {
        console.error(`Failed to delete storage object ${attachment.storage_path}:`, storageErr);
      }

      await query('DELETE FROM attachments WHERE id = $1', [attachment.id]);
      cleanedAttachments++;
    }

    // ── Task 2: Prune in-memory / DB rate limit entries ─────────────────────
    const cleanedRateLimits = pruneRateLimits() ?? 0;

    // ── Task 3: Prune audit log older than 2 years ───────────────────────────
    const auditResult = await query(
      "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '2 years'"
    );
    const prunedAuditRows = auditResult.rowCount ?? 0;

    return res.json({
      cleaned_attachments: cleanedAttachments,
      cleaned_rate_limits: cleanedRateLimits,
      pruned_audit_rows: prunedAuditRows,
    });
  } catch (err) {
    console.error('POST /cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { deviceId } = req.query;

  if (req.method === 'GET') {
    // Device polls for pending tokens
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'deviceId is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    try {
      // Get oldest pending token for this device (status = 'queued')
      const result = await sql`
        SELECT id, token, created_at FROM meqoniqs_tokens 
        WHERE device_id = ${deviceId} AND status = 'queued'
        ORDER BY created_at ASC LIMIT 1
      `;

      if (result.rows.length === 0) {
        return res.status(200).json({ empty: true });
      }

      const tokenRecord = result.rows[0];

      // Mark as dispatched atomically
      await sql`
        UPDATE meqoniqs_tokens 
        SET status = 'dispatched', dispatched_at = NOW() 
        WHERE id = ${tokenRecord.id} AND status = 'queued'
      `;

      // Update device last_seen
      await sql`
        UPDATE meqoniqs_devices 
        SET last_seen = NOW() 
        WHERE id = ${deviceId}
      `;

      return res.status(200).json({
        token: tokenRecord.token,
        id: tokenRecord.id,
        queued_at: tokenRecord.created_at
      });
    } catch (error) {
      console.error('Error fetching token:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch token',
        code: 'DATABASE_ERROR'
      });
    }
  }

  return res.status(405).json({
    ok: false,
    error: 'Method not allowed',
    code: 'METHOD_NOT_ALLOWED'
  });
}

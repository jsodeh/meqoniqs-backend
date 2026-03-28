import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { deviceId } = req.query;

  if (req.method === 'GET') {
    // Device polls for pending tokens
    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    try {
      // Get oldest pending token for this device
      const result = await sql`
        SELECT id, token FROM tokens_queue 
        WHERE device_id = ${deviceId} AND dispatched_at IS NULL 
        ORDER BY created_at ASC LIMIT 1
      `;

      if (result.rows.length === 0) {
        return res.status(200).json({ empty: true });
      }

      const tokenRecord = result.rows[0];

      // Mark as dispatched
      await sql`UPDATE tokens_queue SET dispatched_at = NOW() WHERE id = ${tokenRecord.id}`;

      return res.status(200).json({
        token: tokenRecord.token
      });
    } catch (error) {
      console.error('Error fetching token:', error);
      return res.status(500).json({ error: 'Failed to fetch token' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

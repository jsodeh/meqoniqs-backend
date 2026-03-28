import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // App submits token for device
    const { deviceId, token } = req.body;

    if (!deviceId || !token) {
      return res.status(400).json({ error: 'Missing deviceId or token' });
    }

    try {
      const result = await sql`
        INSERT INTO tokens_queue (id, device_id, token, created_at) 
        VALUES (gen_random_uuid(), ${deviceId}, ${token}, NOW()) 
        RETURNING id
      `;

      return res.status(200).json({
        ok: true,
        id: result.rows[0].id,
        message: 'Token queued for device'
      });
    } catch (error) {
      console.error('Error queuing token:', error);
      return res.status(500).json({ error: 'Failed to queue token' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

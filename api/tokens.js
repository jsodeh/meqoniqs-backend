import { db } from '@vercel/postgres';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // App submits token for device
    const { deviceId, token } = req.body;

    if (!deviceId || !token) {
      return res.status(400).json({ error: 'Missing deviceId or token' });
    }

    try {
      const client = await db.connect();
      
      // Insert into tokens_queue
      const result = await client.query(
        `INSERT INTO tokens_queue (id, device_id, token, created_at) 
         VALUES ($1, $2, $3, NOW()) RETURNING id`,
        [uuidv4(), deviceId, token]
      );

      await client.end();

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

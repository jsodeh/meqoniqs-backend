import { db } from '@vercel/postgres';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Device reports status
    const { deviceId, ip, battery, acPresent, meterConnected } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    try {
      const client = await db.connect();

      // Insert status log
      await client.query(
        `INSERT INTO status_logs (id, device_id, battery_mv, ac_present, meter_connected, logged_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), deviceId, battery || 0, acPresent || false, meterConnected || false]
      );

      // Update device last_seen
      await client.query(
        `UPDATE devices SET last_seen = NOW(), ip_address = $1 
         WHERE id = $2`,
        [ip || '', deviceId]
      );

      await client.end();

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error logging status:', error);
      return res.status(500).json({ error: 'Failed to log status' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

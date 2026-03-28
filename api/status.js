import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Device reports status
    const { deviceId, ip, battery, acPresent, meterConnected } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    try {
      // Insert status log
      await sql`
        INSERT INTO status_logs (id, device_id, battery_mv, ac_present, meter_connected, logged_at)
        VALUES (gen_random_uuid(), ${deviceId}, ${battery || 0}, ${acPresent || false}, ${meterConnected || false}, NOW())
      `;

      // Update device last_seen
      await sql`
        UPDATE devices SET last_seen = NOW(), ip_address = ${ip || ''} 
        WHERE id = ${deviceId}
      `;

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error logging status:', error);
      return res.status(500).json({ error: 'Failed to log status' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

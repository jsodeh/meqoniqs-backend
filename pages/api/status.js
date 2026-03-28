import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { deviceId, ip, battery, acPresent, meterConnected, firmwareVersion } = req.body;

    // Validate deviceId
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'deviceId is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    try {
      // Ensure device exists
      const existing = await sql`SELECT id FROM devices WHERE id = ${deviceId}`;
      if (existing.rows.length === 0) {
        await sql`
          INSERT INTO devices (id, created_at, last_seen)
          VALUES (${deviceId}, NOW(), NOW())
        `;
      }

      // Insert status log
      await sql`
        INSERT INTO status_logs (
          id, device_id, battery_mv, ac_present, 
          meter_connected, firmware_version, logged_at
        )
        VALUES (
          gen_random_uuid(),
          ${deviceId},
          ${battery || 0},
          ${acPresent || false},
          ${meterConnected || false},
          ${firmwareVersion || null},
          NOW()
        )
      `;

      // Update device with latest status
      await sql`
        UPDATE devices 
        SET 
          last_seen = NOW(),
          ip_address = ${ip || null},
          battery_mv = ${battery || null},
          ac_present = ${acPresent || false},
          meter_connected = ${meterConnected || false},
          firmware_version = ${firmwareVersion || null}
        WHERE id = ${deviceId}
      `;

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error logging status:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to log status',
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

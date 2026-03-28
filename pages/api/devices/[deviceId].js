import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { deviceId } = req.query;

  if (req.method === 'GET') {
    // Get device info including IP and status
    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        error: 'deviceId is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    try {
      const result = await sql`
        SELECT 
          id,
          ip_address,
          battery_mv,
          ac_present,
          meter_connected,
          firmware_version,
          last_seen,
          created_at,
          CASE 
            WHEN last_seen > NOW() - INTERVAL '5 minutes' THEN 'online'
            WHEN last_seen > NOW() - INTERVAL '1 hour' THEN 'recently_online'
            ELSE 'offline'
          END as status
        FROM devices
        WHERE id = ${deviceId}
      `;

      if (result.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'Device not found',
          code: 'DEVICE_NOT_FOUND'
        });
      }

      const device = result.rows[0];
      return res.status(200).json({
        id: device.id,
        ip_address: device.ip_address,
        last_seen: device.last_seen,
        created_at: device.created_at,
        status: device.status,
        battery: device.battery_mv,
        ac_present: device.ac_present,
        meter_connected: device.meter_connected,
        firmware_version: device.firmware_version
      });
    } catch (error) {
      console.error('Error fetching device:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch device',
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

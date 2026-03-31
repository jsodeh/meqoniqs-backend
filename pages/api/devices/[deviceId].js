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
          md.id,
          md.device_name,
          md.user_id,
          md.meter_id,
          md.meter_number,
          md.ip_address,
          md.battery_mv,
          md.ac_present,
          md.meter_connected,
          md.firmware_version,
          md.rssi,
          md.last_seen,
          md.last_status_update,
          md.created_at,
          mms.balance,
          mms.consumption,
          mms.updated_at as meter_updated_at,
          CASE 
            WHEN md.last_seen > NOW() - INTERVAL '5 minutes' THEN 'online'
            WHEN md.last_seen > NOW() - INTERVAL '1 hour' THEN 'recently_online'
            ELSE 'offline'
          END as status
        FROM meqoniqs_devices md
        LEFT JOIN meqoniqs_meter_state mms ON md.id = mms.device_id
        WHERE md.id = ${deviceId}
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
        ok: true,
        device: {
          id: device.id,
          device_name: device.device_name,
          user_id: device.user_id,
          meter_id: device.meter_id,
          meter_number: device.meter_number,
          ip_address: device.ip_address,
          status: device.status,
          battery_mv: device.battery_mv,
          ac_present: device.ac_present,
          meter_connected: device.meter_connected,
          firmware_version: device.firmware_version,
          rssi: device.rssi,
          last_seen: device.last_seen,
          last_status_update: device.last_status_update,
          created_at: device.created_at,
          meter: {
            balance: device.balance,
            consumption: device.consumption,
            updated_at: device.meter_updated_at
          }
        }
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

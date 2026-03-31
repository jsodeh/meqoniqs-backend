import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const {
      deviceId,
      ip,
      battery,
      acPresent,
      meterConnected,
      firmwareVersion,
      meterNumber,
      meterId,
      balance,
      consumption,
      rssi
    } = req.body;

    // Validate deviceId
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'deviceId is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    try {
      // Ensure device exists in unified database
      const existing = await sql`SELECT id FROM meqoniqs_devices WHERE id = ${deviceId}`;
      if (existing.rows.length === 0) {
        await sql`
          INSERT INTO meqoniqs_devices (id, device_name, created_at, last_seen)
          VALUES (${deviceId}, 'Meqoniqs Device', NOW(), NOW())
        `;
      }

      // Insert status log for historical tracking
      await sql`
        INSERT INTO meqoniqs_status_logs (
          id, device_id, battery_mv, ac_present, 
          meter_connected, logged_at
        )
        VALUES (
          gen_random_uuid(),
          ${deviceId},
          ${battery || 0},
          ${acPresent || false},
          ${meterConnected || false},
          NOW()
        )
      `;

      // Update device with latest status and meter info
      await sql`
        UPDATE meqoniqs_devices 
        SET 
          last_seen = NOW(),
          last_status_update = NOW(),
          ip_address = ${ip || null},
          battery_mv = ${battery || null},
          ac_present = ${acPresent || false},
          meter_connected = ${meterConnected || false},
          firmware_version = ${firmwareVersion || null},
          meter_number = ${meterNumber || meterId || null},
          rssi = ${rssi || null}
        WHERE id = ${deviceId}
      `;

      // Update or insert meter state if provided
      if (balance !== undefined || consumption !== undefined) {
        await sql`
          INSERT INTO meqoniqs_meter_state (
            device_id, balance, consumption, updated_at
          )
          VALUES (${deviceId}, ${balance || 0}, ${consumption || 0}, NOW())
          ON CONFLICT (device_id) DO UPDATE
          SET
            balance = COALESCE(EXCLUDED.balance, meqoniqs_meter_state.balance),
            consumption = COALESCE(EXCLUDED.consumption, meqoniqs_meter_state.consumption),
            updated_at = NOW()
        `;
      }

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

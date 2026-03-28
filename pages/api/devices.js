import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Register device
    const { deviceId, userId, meterId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        error: 'deviceId is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    try {
      const result = await sql`
        INSERT INTO devices (id, user_id, meter_id, created_at, last_seen)
        VALUES (${deviceId}, ${userId || null}, ${meterId || null}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET user_id = COALESCE(EXCLUDED.user_id, devices.user_id),
            meter_id = COALESCE(EXCLUDED.meter_id, devices.meter_id),
            last_seen = NOW()
        RETURNING id, created_at
      `;

      return res.status(200).json({
        ok: true,
        device: {
          id: result.rows[0].id,
          created_at: result.rows[0].created_at
        }
      });
    } catch (error) {
      console.error('Error registering device:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to register device',
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

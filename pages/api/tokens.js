import { sql } from '@vercel/postgres';

const TOKEN_LENGTH = 20;
const DEVICE_ID_MIN_LEN = 5;

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { deviceId, token, userId } = req.body;

    // Validate inputs
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'deviceId is required and must be a string',
        code: 'MISSING_DEVICE_ID'
      });
    }

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'token is required and must be a string',
        code: 'MISSING_TOKEN'
      });
    }

    if (token.length !== TOKEN_LENGTH) {
      return res.status(400).json({
        ok: false,
        error: `Token must be exactly ${TOKEN_LENGTH} digits`,
        code: 'INVALID_TOKEN'
      });
    }

    if (!/^\d+$/.test(token)) {
      return res.status(400).json({
        ok: false,
        error: 'Token must contain only digits',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }

    if (deviceId.length < DEVICE_ID_MIN_LEN) {
      return res.status(400).json({
        ok: false,
        error: `deviceId must be at least ${DEVICE_ID_MIN_LEN} characters`,
        code: 'INVALID_DEVICE_ID'
      });
    }

    try {
      // Check if device exists in unified database
      const deviceCheck = await sql`
        SELECT id FROM meqoniqs_devices WHERE id = ${deviceId}
      `;

      // If device doesn't exist, optionally create it
      if (deviceCheck.rows.length === 0) {
        await sql`
          INSERT INTO meqoniqs_devices (id, user_id, device_name, created_at, last_seen)
          VALUES (${deviceId}, ${userId || null}, 'Meqoniqs Device', NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `;
      }

      // Insert into meqoniqs_tokens with 'queued' status
      const result = await sql`
        INSERT INTO meqoniqs_tokens (id, device_id, user_id, token, status, created_at) 
        VALUES (gen_random_uuid(), ${deviceId}, ${userId || null}, ${token}, 'queued', NOW()) 
        RETURNING id, created_at
      `;

      return res.status(200).json({
        ok: true,
        id: result.rows[0].id,
        queued_at: result.rows[0].created_at,
        method: 'cloud',
        status: 'waiting_for_device_poll'
      });
    } catch (error) {
      console.error('Error queuing token:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to queue token',
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

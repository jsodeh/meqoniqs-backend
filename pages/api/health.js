import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Test database connection
      const result = await sql`SELECT COUNT(*) as count FROM meqoniqs_devices`;
      
      return res.status(200).json({
        ok: true,
        service: 'MetroPush Backend API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        status: 'operational',
        database: {
          connected: true,
          devices_count: parseInt(result.rows[0].count)
        }
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        service: 'MetroPush Backend API',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: error.message,
        code: error.code,
        database: {
          connected: false,
          error_detail: error.detail,
          suggestion: error.message.includes('does not exist') 
            ? '❌ Tables not created. Execute schema.sql in Neon console or run: psql $POSTGRES_URL < schema.sql'
            : '❌ Database connection failed. Check POSTGRES_URL env variable'
        }
      });
    }
  }

  return res.status(405).json({
    ok: false,
    error: 'Method not allowed'
  });
}

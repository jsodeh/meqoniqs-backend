export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    env_check: {
      postgres_url_exists: !!process.env.POSTGRES_URL,
      node_env: process.env.NODE_ENV
    }
  });
}

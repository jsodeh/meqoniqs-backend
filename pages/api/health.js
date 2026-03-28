export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'MetroPush Backend API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      status: 'operational'
    });
  }

  return res.status(405).json({
    ok: false,
    error: 'Method not allowed'
  });
}

# MetroPush Backend API

Cloud backend for MetroPush IoT remote token provisioning and device management.

## Features

- Token queueing for remote submission
- Device polling endpoint
- Device status logging
- Vercel deployment ready
- PostgreSQL database

## API Endpoints

### `/api/tokens` (POST)
Load a token for a device remotely.

**Request:**
```json
{
  "deviceId": "metro-001",
  "token": "12345678901234567890"
}
```

**Response:**
```json
{
  "ok": true,
  "id": "uuid-here"
}
```

### `/api/tokens/[deviceId]` (GET)
Device polls for pending tokens.

**Response:**
```json
{
  "token": "12345678901234567890"
}
```
or if no tokens:
```json
{
  "empty": true
}
```

### `/api/status` (POST)
Device reports status for analytics.

**Request:**
```json
{
  "deviceId": "metro-001",
  "ip": "192.168.1.100",
  "battery": 3.7,
  "acPresent": true,
  "meterConnected": true
}
```

## Deployment

### Prerequisites
- GitHub account
- Vercel account (free tier available)
- PostgreSQL database (Vercel Postgres or external)

### Steps

1. **Create GitHub repos:**
   - Push firmware to `metropush-firmware`
   - Push backend to `metropush-backend`

2. **Deploy to Vercel:**
   - Connect your GitHub account to Vercel
   - Import `metropush-backend` repo
   - Set environment variables in Vercel dashboard
   - Deploy (automatic on push)

3. **Connect database:**
   - Use Vercel Postgres (integrate in dashboard)
   - Or connect external PostgreSQL

## Local Development

```bash
npm install
npm run dev
# Server runs on http://localhost:3000
```

## Environment Variables

Set in Vercel dashboard or `.env.local`:

```
POSTGRES_URLCONNECT_STRING=your-db-url
NEXT_PUBLIC_API_URL=https://your-vercel-app.vercel.app
```

## Schema

### devices table
```sql
CREATE TABLE devices (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(100),
  meter_id VARCHAR(20),
  ip_address VARCHAR(15),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP
);

CREATE TABLE tokens_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id),
  token VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMP
);

CREATE TABLE status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id),
  battery_mv INT,
  ac_present BOOLEAN,
  meter_connected BOOLEAN,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

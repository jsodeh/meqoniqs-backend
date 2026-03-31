# Meqoniqs Backend API

Cloud backend for Meqoniqs IoT remote token provisioning and device management.

## Features

- Hybrid token loading (local + cloud fallback)
- Device discovery and registration
- Token queueing for remote submission
- Real-time device status logging
- Vercel deployment ready
- PostgreSQL database

## Token Loading Workflow

### Smart Hybrid Pattern (Local-First with Cloud Fallback)

```
App attempts token load:
  1. Try LOCAL: POST http://{device-ip}:{port}/token (3s timeout)
     └─ If SUCCESS: Token applied immediately
     └─ If TIMEOUT/404: Proceed to step 2
  
  2. Fallback to CLOUD: POST https://meqoniqs-backend.vercel.app/api/tokens
     └─ Queue token in database
     └─ Device polls and picks up within 60s
     └─ When device checks in, pull and apply token
```

**This ensures:**
- ✅ Sub-second latency when on same WiFi
- ✅ Graceful degradation when remote
- ✅ No user perceives failure
- ✅ Works offline (syncs when device reconnects)

---

## API Reference

### 1. Token Loading (Cloud Path - Fallback)

**POST** `/api/tokens`

Load a token remotely. Called when local attempt fails.

**Request Body:**
```json
{
  "deviceId": "metro-001",
  "token": "12345678901234567890",
  "userId": "user-uuid-optional"
}
```

**Response (Success):**
```json
{
  "ok": true,
  "id": "uuid-token-queue-record",
  "queued_at": "2026-03-28T21:30:00Z",
  "method": "cloud",
  "status": "waiting_for_device_poll"
}
```

**Response (Validation Error):**
```json
{
  "ok": false,
  "error": "Token must be 20 digits",
  "code": "INVALID_TOKEN"
}
```

**Response (Device Not Found):**
```json
{
  "ok": false,
  "error": "Device not registered. Register via setup first.",
  "code": "DEVICE_NOT_FOUND"
}
```

---

### 2. Device Token Poll (Cloud Path)

**GET** `/api/tokens/[deviceId]`

Device polls for pending tokens. Called by device every 60 seconds.

**Query Parameters:**
- `deviceId` (required): Device identifier

**Response (Token Pending):**
```json
{
  "token": "12345678901234567890",
  "id": "uuid",
  "queued_at": "2026-03-28T21:30:00Z"
}
```

**Response (No Tokens):**
```json
{
  "empty": true
}
```

**Response (Success):**
- Token is marked as `dispatched_at: NOW()` to prevent re-delivery
- Next poll will return `empty`

---

### 3. Device Status Reporting

**POST** `/api/status`

Device reports status for analytics and presence tracking.

**Request Body:**
```json
{
  "deviceId": "metro-001",
  "ip": "192.168.1.100",
  "battery": 3700,
  "acPresent": true,
  "meterConnected": true,
  "firmwareVersion": "1.0.0"
}
```

**Response:**
```json
{
  "ok": true
}
```

---

### 4. Device Registration (Setup)

**POST** `/api/devices`

Register device after provisioning (optional, for tracking).

**Request Body:**
```json
{
  "deviceId": "metro-001",
  "userId": "user-uuid",
  "meterId": "12345678"
}
```

**Response:**
```json
{
  "ok": true,
  "device": {
    "id": "metro-001",
    "created_at": "2026-03-28T21:00:00Z"
  }
}
```

---

### 5. Device Discovery (Get Device IP)

**GET** `/api/devices/[deviceId]`

Retrieve device info including last known IP.

**Response:**
```json
{
  "id": "metro-001",
  "ip_address": "192.168.1.100",
  "last_seen": "2026-03-28T21:25:00Z",
  "status": "online",
  "battery": 3700,
  "ac_present": true
}
```

---

## Mobile App Implementation Guide

### Phase 1: Local + Cloud Hybrid

```javascript
class MetroPushAPI {
  // Discover device on local network
  async discoverDevice() {
    // Scan network for http://192.168.x.x/api/status
    // Or use mDNS: _http._tcp service discovery
    // Store deviceIp for later use
    return deviceIp;
  }

  // Load token with fallback
  async loadToken(token, deviceId, deviceIp) {
    const result = {
      token,
      deviceId,
      method: null,
      error: null
    };

    // Step 1: Try local (immediate)
    if (deviceIp) {
      try {
        const response = await fetch(`http://${deviceIp}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          timeout: 3000  // 3 second timeout
        });

        if (response.ok) {
          result.method = 'local';
          result.status = 'applied_immediately';
          return result;
        }
      } catch (e) {
        console.log('Local load failed, trying cloud:', e.message);
        // Continue to cloud
      }
    }

    // Step 2: Fallback to cloud
    try {
      const response = await fetch('https://meqoniqs-backend.vercel.app/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          token,
          userId: currentUserId
        })
      });

      if (response.ok) {
        const data = await response.json();
        result.method = 'cloud';
        result.status = 'queued_for_sync';
        result.queueId = data.id;
        return result;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Token load failed');
      }
    } catch (e) {
      result.error = e.message;
      return result;
    }
  }

  // Check device status
  async getDeviceStatus(deviceId) {
    try {
      const response = await fetch(`https://meqoniqs-backend.vercel.app/api/devices/${deviceId}`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}
```

### UI/UX Flow

```
User: "Load Token"
  ↓
App: "Loading... (trying local first)" [spinner, 3s]
  ├─ Success (local): "✅ Token loaded to meter!"
  │
  └─ Timeout (cloud): "⏱️ Syncing... Device will connect within 1 minute"
       Later: "✅ Token synced and applied"
```

---

## Database Schema

### devices table
```sql
CREATE TABLE devices (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(100),
  meter_id VARCHAR(20),
  ip_address VARCHAR(15),
  battery_mv INT,
  ac_present BOOLEAN,
  meter_connected BOOLEAN,
  firmware_version VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP
);
```

### tokens_queue table
```sql
CREATE TABLE tokens_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
  token VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMP,
  CHECK (LENGTH(token) = 20)
);
```

### status_logs table
```sql
CREATE TABLE status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
  battery_mv INT,
  ac_present BOOLEAN,
  meter_connected BOOLEAN,
  firmware_version VARCHAR(20),
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Deployment

1. Push to GitHub
2. Connect to Vercel
3. Set environment: `POSTGRES_URLCONNECT_STRING=your-neon-connection`
4. Vercel auto-deploys
5. Initialize schema in Neon

## Testing

```bash
# Test cloud token queueing
curl -X POST https://meqoniqs-backend.vercel.app/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"metro-001","token":"12345678901234567890"}'

# Test device poll
curl https://meqoniqs-backend.vercel.app/api/tokens/metro-001

# Test status reporting
curl -X POST https://meqoniqs-backend.vercel.app/api/status \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"metro-001","ip":"192.168.1.100","battery":3700,"acPresent":true}'
```

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

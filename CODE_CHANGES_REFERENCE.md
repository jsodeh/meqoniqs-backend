# Backend Code Changes - Quick Reference

## Summary of Changes

All backend API endpoints in `/pages/api/` have been updated to use the unified database schema with `meqoniqs_*` table names.

---

## File-by-File Changes

### 1. `/pages/api/tokens.js` - Token Queueing Endpoint

**What Changed:**
- Table reference: `devices` → `meqoniqs_devices`
- Table reference: `tokens_queue` → `meqoniqs_tokens`
- New field: `status` column set to `'queued'` instead of relying on `dispatched_at IS NULL`
- New field: `user_id` stored with token for tracking

**Key Lines:**
```javascript
// OLD: INSERT INTO tokens_queue (id, device_id, token, created_at)
// NEW: INSERT INTO meqoniqs_tokens (id, device_id, user_id, token, status, created_at)

INSERT INTO meqoniqs_tokens (id, device_id, user_id, token, status, created_at) 
VALUES (gen_random_uuid(), ${deviceId}, ${userId || null}, ${token}, 'queued', NOW()) 
```

**Validation:** Token must be exactly 20 digits (already implemented).

---

### 2. `/pages/api/tokens/[deviceId].js` - Device Token Polling

**What Changed:**
- Query condition: `dispatched_at IS NULL` → `status = 'queued'`
- Update query: Sets both `status = 'dispatched'` AND `dispatched_at = NOW()`
- Device tracking: Updates `meqoniqs_devices.last_seen` on every poll

**Key Lines:**
```javascript
// OLD: WHERE device_id = ${deviceId} AND dispatched_at IS NULL
// NEW: WHERE device_id = ${deviceId} AND status = 'queued'

SELECT id, token, created_at FROM meqoniqs_tokens 
WHERE device_id = ${deviceId} AND status = 'queued'
ORDER BY created_at ASC LIMIT 1

// OLD: UPDATE tokens_queue SET dispatched_at = NOW()
// NEW: UPDATE meqoniqs_tokens SET status = 'dispatched', dispatched_at = NOW()

UPDATE meqoniqs_tokens 
SET status = 'dispatched', dispatched_at = NOW() 
WHERE id = ${tokenRecord.id} AND status = 'queued'

// NEW: Also update device last_seen
UPDATE meqoniqs_devices SET last_seen = NOW() WHERE id = ${deviceId}
```

---

### 3. `/pages/api/status.js` - Device Status Reporting

**What Changed:**
- Table: `devices` → `meqoniqs_devices`
- Table: `status_logs` → `meqoniqs_status_logs`
- New table: Inserts into `meqoniqs_meter_state` for current meter values
- Enhanced fields: Now stores `meterNumber`, `balance`, `consumption`, `rssi`, `firmwareVersion`
- New method: Upsert pattern for meter state (INSERT ... ON CONFLICT DO UPDATE)

**Key Lines:**
```javascript
// Store comprehensive device status
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

// Store meter state (insert or update)
INSERT INTO meqoniqs_meter_state (device_id, balance, consumption, updated_at)
VALUES (${deviceId}, ${balance || 0}, ${consumption || 0}, NOW())
ON CONFLICT (device_id) DO UPDATE
SET
  balance = COALESCE(EXCLUDED.balance, meqoniqs_meter_state.balance),
  consumption = COALESCE(EXCLUDED.consumption, meqoniqs_meter_state.consumption),
  updated_at = NOW()
```

---

### 4. `/pages/api/devices.js` - Device Registration

**What Changed:**
- Table: `devices` → `meqoniqs_devices`
- New fields: `meter_number`, `device_name` added to insert/upsert

**Key Lines:**
```javascript
// OLD: INSERT INTO devices (id, user_id, meter_id, ...)
// NEW: INSERT INTO meqoniqs_devices (id, user_id, meter_id, meter_number, device_name, ...)

INSERT INTO meqoniqs_devices (
  id, user_id, meter_id, meter_number, device_name, created_at, last_seen
)
VALUES (
  ${deviceId},
  ${userId || null},
  ${meterId || null},
  ${meterNumber || null},
  ${deviceName || 'Meqoniqs Device'},
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  user_id = COALESCE(EXCLUDED.user_id, meqoniqs_devices.user_id),
  meter_id = COALESCE(EXCLUDED.meter_id, meqoniqs_devices.meter_id),
  meter_number = COALESCE(EXCLUDED.meter_number, meqoniqs_devices.meter_number),
  device_name = COALESCE(EXCLUDED.device_name, meqoniqs_devices.device_name),
  last_seen = NOW()
```

---

### 5. `/pages/api/devices/[deviceId].js` - Get Device Info

**What Changed:**
- Table: `devices` → `meqoniqs_devices`
- New: LEFT JOIN with `meqoniqs_meter_state` to get meter balance/consumption
- New fields: Returns `meter_number`, `rssi`, `firmware_version`, `last_status_update`
- Response structure: Meter data grouped under `meter` object

**Key Lines:**
```javascript
// OLD: SELECT ... FROM devices
// NEW: SELECT ... FROM meqoniqs_devices LEFT JOIN meqoniqs_meter_state

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

// Response structure
{
  "ok": true,
  "device": {
    "id": "...",
    "device_name": "...",
    "meter_number": "...",
    "status": "online",
    "meter": {
      "balance": 1234.56,
      "consumption": 567.89,
      "updated_at": "..."
    }
  }
}
```

---

## API Contracts (No Breaking Changes)

All API request/response formats remain **backward compatible**.

### POST /api/tokens
```javascript
// Request - SAME as before
{ "deviceId": "...", "token": "...", "userId": "..." }

// Response - ENHANCED (new fields but still ok: true)
{ "ok": true, "id": "...", "queued_at": "...", "method": "cloud", "status": "..." }
```

### GET /api/tokens/[deviceId]
```javascript
// Response - SAME structure, different database
{ "token": "...", "id": "...", "queued_at": "..." }
// OR
{ "empty": true }
```

### POST /api/status
```javascript
// Request - ENHANCED (new optional fields)
{
  "deviceId": "...",
  "ip": "...",
  "battery": 3700,
  "acPresent": true,
  "meterConnected": true,
  // NEW OPTIONAL FIELDS:
  "meterNumber": "...",
  "balance": 1234.56,
  "consumption": 567.89,
  "firmwareVersion": "...",
  "rssi": -45
}

// Response - SAME
{ "ok": true }
```

### POST /api/devices
```javascript
// Request - ENHANCED (new optional fields)
{
  "deviceId": "...",
  "userId": "...",
  "meterId": "...",
  // NEW OPTIONAL FIELDS:
  "meterNumber": "...",
  "deviceName": "..."
}

// Response - SAME
{ "ok": true, "device": { "id": "...", "created_at": "..." } }
```

### GET /api/devices/[deviceId]
```javascript
// Response - ENHANCED with meter data
{
  "ok": true,
  "device": {
    // Existing fields
    "id": "...",
    "status": "online",
    "ip_address": "...",
    "battery_mv": 3700,
    "last_seen": "...",
    // NEW fields
    "device_name": "Kitchen Meter",
    "meter_number": "87654321",
    "firmware_version": "v1.0.0",
    "rssi": -45,
    "last_status_update": "...",
    // NEW OBJECT
    "meter": {
      "balance": 1234.56,
      "consumption": 567.89,
      "updated_at": "..."
    }
  }
}
```

---

## Environment & Deployment

**No new environment variables needed.**

Uses existing `POSTGRES_URLSTATE` environment variable that now points to your unified Neon database.

**Deployment:**
1. Push changes to GitHub
2. Vercel auto-deploys
3. All endpoints automatically use new `meqoniqs_*` tables
4. No downtime during migration

```bash
# Verify deployment
curl https://meqoniqs-backend.vercel.app/health
# Should return: { "ok": true, "service": "MetroPush Backend API", ... }
```

---

## Testing Command Reference

```bash
# Test token queueing
curl -X POST https://meqoniqs-backend.vercel.app/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"TEST001","token":"12345678901234567890","userId":"user-123"}'

# Test device polling
curl -X GET https://meqoniqs-backend.vercel.app/api/tokens/TEST001

# Test status update
curl -X POST https://meqoniqs-backend.vercel.app/api/status \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"TEST001","ip":"192.168.1.1","battery":3700,"acPresent":true,"meterConnected":true,"meterNumber":"12345678","balance":500.50,"consumption":1200.75}'

# Test device registration
curl -X POST https://meqoniqs-backend.vercel.app/api/devices \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"TEST001","userId":"user-123","deviceName":"Test Device"}'

# Get device info
curl -X GET https://meqoniqs-backend.vercel.app/api/devices/TEST001
```

---

## Code Review Checklist

- ✅ All table names updated: `devices` → `meqoniqs_devices`
- ✅ All table names updated: `tokens_queue` → `meqoniqs_tokens`
- ✅ Status enum used: `WHERE status = 'queued'` instead of `dispatched_at IS NULL`
- ✅ Device last_seen updated on every operation
- ✅ Meter state stored in separate table
- ✅ Error messages preserved
- ✅ Validation unchanged
- ✅ Response formats backward compatible
- ✅ Foreign keys intact
- ✅ Indexes in place for performance

---

## Support & Rollback

If issues occur:

1. **Check Logs:** Vercel deployment logs show SQL errors
2. **Verify Schema:** Log into Neon console, inspect table structure
3. **Test Endpoint:** Use curl commands above to isolate problems
4. **Rollback (if needed):** Switch back to old code, redeploy
5. **Contact:** Debug in Neon query editor before re-deploying

---

**Migration Status:** ✅ COMPLETE  
**All Endpoints:** ✅ UPDATED  
**Database:** ✅ UNIFIED  
**Testing:** ⏳ IN PROGRESS

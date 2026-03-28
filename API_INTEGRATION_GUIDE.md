# MetroPush Hybrid Token Loading - API Integration Guide

## Overview

This document explains the **hybrid token loading system** with clear workflows for both local and remote scenarios.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MOBILE APP                               │
│  - Manages provisioning                                      │
│  - Handles token loading UI                                 │
│  - Discovers device on local network                        │
└──────────┬──────────────────────┬──────────────────────────┘
           │                      │
    ┌──────▼──────┐      ┌───────▼────────┐
    │ TRY LOCAL   │      │ CLOUD FALLBACK │
    │ (if IP OK)  │      │ (if local fail)│
    └──────┬──────┘      └───────┬────────┘
           │                     │
    ┌──────▼──────┐              │
    │  ESP32      │              │
    │  /token     │              │
    │  endpoint   │              │
    │  (instant)  │              │
    └─────────────┘              │
                          ┌──────▼──────────┐
                          │  VERCEL BACKEND │
                          │  - POST /tokens │
                          │  - Queue DB     │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │  ESP32 Polls    │
                          │  GET /tokens/:id│
                          │  (every 60s)    │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ Receives token  │
                          │ Applies to meter│
                          └─────────────────┘
```

---

## Workflows

### Workflow 1: Local Token Loading (Same WiFi)

**User is home, device discoverable on local network**

```
User App: Click "Load Token"
    ↓
App Has: device_ip = "192.168.1.100"
    ↓
App: POST http://192.168.1.100/token
     timeout: 3000ms
     body: { "token": "12345678901234567890" }
    ↓
CASE 1a: Device responds (SUCCESS)
    ✅ Token applied immediately
    ✅ Message: "Token loaded to meter"
    ✅ Latency: < 1 second

CASE 1b: Timeout or connection error
    → Continue to Workflow 2 (cloud fallback)
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Token submitted to meter"
}
```

---

### Workflow 2: Cloud Token Loading (Remote Fallback)

**User is remote, device not on local network**

```
User App: Click "Load Token"
    ↓
App: Try local → TIMEOUT
    ↓
App: POST https://meqoniqs-backend.vercel.app/api/tokens
     body: {
       "deviceId": "metro-001",
       "token": "12345678901234567890",
       "userId": "user-uuid"
     }
    ↓
Backend: 
  ✅ Validates token (20 digits, numeric only)
  ✅ Creates tokens_queue record
  ✅ Returns queue ID
    ↓
App Response:
  {
    "ok": true,
    "id": "uuid-queue-record",
    "method": "cloud",
    "status": "waiting_for_device_poll"
  }
    ↓
User Sees: "⏱️ Syncing... Device will apply within 1 minute"
    ↓
ESP32 (every 60s):
  GET /api/tokens/metro-001
  ↓
Backend: Finds oldest pending token
  ↓
ESP32 receives and submits to meter via Modbus
  ↓
User Sees: "✅ Token synced and applied"
```

---

## API Endpoints (Comprehensive)

### 1. POST /api/tokens - Queue Token (Cloud)

**Description:** Queue a token for a device (fallback when local unavailable)

**Endpoint:** `POST https://meqoniqs-backend.vercel.app/api/tokens`

**Request:**
```bash
curl -X POST https://meqoniqs-backend.vercel.app/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "metro-001",
    "token": "12345678901234567890",
    "userId": "user-uuid-optional"
  }'
```

**Success Response (200):**
```json
{
  "ok": true,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queued_at": "2026-03-28T21:30:00.000Z",
  "method": "cloud",
  "status": "waiting_for_device_poll"
}
```

**Validation Error (400):**
```json
{
  "ok": false,
  "error": "Token must be exactly 20 digits",
  "code": "INVALID_TOKEN"
}
```

**Validation Errors:**
- `MISSING_DEVICE_ID`: deviceId not provided
- `MISSING_TOKEN`: token not provided
- `INVALID_TOKEN`: token not exactly 20 chars
- `INVALID_TOKEN_FORMAT`: token contains non-digits
- `INVALID_DEVICE_ID`: deviceId too short

---

### 2. GET /api/tokens/[deviceId] - Poll for Token

**Description:** Device polls for pending tokens (called by firmware every 60s)

**Endpoint:** `GET https://meqoniqs-backend.vercel.app/api/tokens/metro-001`

**Success Response (token pending):**
```json
{
  "token": "12345678901234567890",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queued_at": "2026-03-28T21:30:00.000Z"
}
```

**Success Response (no tokens pending):**
```json
{
  "empty": true
}
```

**Server guarantees:**
- Token marked as `dispatched_at` after first fetch
- Next poll returns `empty`
- No duplicate token delivery
- Device `last_seen` timestamp updated automatically

---

### 3. POST /api/status - Device Report Status

**Description:** Device reports battery, AC, connectivity status (optional, for analytics)

**Endpoint:** `POST https://meqoniqs-backend.vercel.app/api/status`

**Request:**
```bash
curl -X POST https://meqoniqs-backend.vercel.app/api/status \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "metro-001",
    "ip": "192.168.1.100",
    "battery": 3700,
    "acPresent": true,
    "meterConnected": true,
    "firmwareVersion": "1.0.0"
  }'
```

**Response:**
```json
{
  "ok": true
}
```

---

### 4. POST /api/devices - Register Device

**Description:** Register device for tracking (optional, auto-created on first token)

**Endpoint:** `POST https://meqoniqs-backend.vercel.app/api/devices`

**Request:**
```bash
curl -X POST https://meqoniqs-backend.vercel.app/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "metro-001",
    "userId": "user-uuid",
    "meterId": "12345678"
  }'
```

**Response:**
```json
{
  "ok": true,
  "device": {
    "id": "metro-001",
    "created_at": "2026-03-28T21:00:00.000Z"
  }
}
```

---

### 5. GET /api/devices/[deviceId] - Get Device Info

**Description:** Get device details including IP, battery, status, last contact

**Endpoint:** `GET https://meqoniqs-backend.vercel.app/api/devices/metro-001`

**Response:**
```json
{
  "id": "metro-001",
  "ip_address": "192.168.1.100",
  "last_seen": "2026-03-28T21:25:00.000Z",
  "created_at": "2026-03-28T21:00:00.000Z",
  "status": "online",
  "battery": 3700,
  "ac_present": true,
  "meter_connected": true,
  "firmware_version": "1.0.0"
}
```

**Status Values:**
- `"online"` - last_seen within 5 minutes
- `"recently_online"` - last_seen within 1 hour
- `"offline"` - last_seen > 1 hour ago

---

### 6. GET /api/health - Service Health

**Description:** Health check endpoint

**Response:**
```json
{
  "ok": true,
  "service": "MetroPush Backend API",
  "version": "1.0.0",
  "timestamp": "2026-03-28T21:30:00.000Z",
  "status": "operational"
}
```

---

## Error Handling

All errors follow standard JSON format:

```json
{
  "ok": false,
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common HTTP Status Codes:
- `200 OK` - Success
- `400 Bad Request` - Validation error (check `code` field)
- `404 Not Found` - Resource not found
- `405 Method Not Allowed` - GET vs POST mismatch
- `500 Internal Server Error` - Database error

---

## Implementation Checklist for Mobile App

- [ ] Discovery: Scan local network for `http://<ip>/api/status`
- [ ] Storage: Save device_id and device_ip
- [ ] Token Load: Implement try-local-then-cloud flow
- [ ] Timeout: Set 3-second timeout for local attempts
- [ ] Fallback: On timeout, POST to cloud endpoint
- [ ] UI: Show "Loading (local)" → "Syncing (cloud)" messages
- [ ] Polling: Don't poll cloud repeatedly; wait for response
- [ ] Error Handling: Validate token format before sending
- [ ] Status Display: Show device status from `/api/devices/[id]`

---

## Testing Checklist

- [ ] Local token load with direct IP
- [ ] Cloud token load with device offline
- [ ] Cloud token load with device on different WiFi
- [ ] Device poll retrieves token from queue
- [ ] Duplicate token not returned on re-poll
- [ ] Device status updates saved to database
- [ ] API validation rejects invalid tokens
- [ ] API validation rejects invalid deviceIds

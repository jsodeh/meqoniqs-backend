# Meqoniqs Complete System Architecture & Data Flow

## Executive Summary

Meqoniqs is an **ESP32-based IoT meter gateway** that enables remote STS token provisioning with dual discovery (WiFi + BLE) and cloud fallback. This document explains the entire system from firmware initialization through cloud data operations and provides a database harmonization strategy.

**Key Components:**
- **Firmware:** ESP-IDF 6.1 with FreeRTOS (4 parallel tasks)
- **Device:** ESP32-D0WD-V3 with WiFi, BLE, RS-485 (Modbus)
- **Backend:** Node.js/Next.js on Vercel with PostgreSQL (Neon)
- **Data Path:** Device → Cloud via polling + local HTTP fallback
- **Meter Type:** Any Modbus RTU meter (auto-detect 9600/19200 baud)

---

## Part 1: Firmware Architecture & Updated Features

### 1.1 Recent Enhancement: Enhanced `/api/status` Response

**What Changed:**
Previously, `/api/status` returned only:
```json
{ "status": "ok", "ip": "192.168.1.42" }
```

**Now Returns (Fully Implemented):**
```json
{
  "status": "ok",
  "ip": "192.168.1.42",
  "device_id": "2805A52FD478",
  "meter_number": "12345678",
  "balance": 1234.56,
  "consumption": 567.89,
  "provisioned": true,
  "rssi": -45
}
```

**How It Works:**
```c
// Device ID: Generated from MAC address (thread-safe)
uint8_t mac[6];
esp_read_mac(mac, ESP_MAC_WIFI_STA);
char device_id[20];
snprintf(device_id, sizeof(device_id), "%02X%02X%02X%02X%02X%02X", 
         mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

// Meter Number: Retrieved from RS-485 device
char meter_id[16] = "unknown";
modbus_rs485_get_meter_id(meter_id, sizeof(meter_id));

// Meter Data: Fetched from cached values (thread-safe semaphore)
float balance = meter_data_get_balance();        // Updated every 10s
float consumption = meter_data_get_consumption(); // Updated every 10s

// WiFi Signal: RSSI when connected to home network
wifi_ap_record_t ap_info;
esp_wifi_sta_get_ap_info(&ap_info);
int8_t rssi = ap_info.rssi;
```

### 1.2 Four Core Tasks (Running Parallel)

```
┌─────────────────────────────────────────────────────────────┐
│                  MEQONIQS FIRMWARE (FreeRTOS)               │
│                   4 Parallel Tasks                          │
└─────────────────────────────────────────────────────────────┘

[Task A: CONNECTIVITY]                    [Task B: METER]
├─ WiFi (AP/STA modes)                     ├─ RS-485 Modbus
├─ BLE provisioning                        ├─ Auto-detect baud rate
├─ HTTP Server (port 80)                   ├─ Read balance/consumption
├─ Cloud polling (60s)                     ├─ Cache values (mutex)
└─ Token queue delivery                    └─ Update every 10s

[Task C: STS ENGINE]                      [Task D: POWER]
├─ Process token queue                     ├─ Monitor battery/AC
├─ Submit tokens to meter                  ├─ Control status LED
├─ Modbus write commands                   ├─ Low power shutdown
└─ Retry logic on failure                  └─ Heartbeat (2s)
```

### 1.3 Task Data Flows

**Task A - Connectivity (WiFi + HTTP + Cloud Polling):**
```c
while (1) {
    // 1. Dual-mode WiFi running (AP initially, STA after provisioning)
    // 2. HTTP server listening on port 80
    // 3. Every 60s (if provisioned): Poll cloud for tokens
    HTTPS GET /api/tokens/[deviceId]
    ↓
    if (token received) {
        Enqueue token to token_queue
    }
    
    vTaskDelay(60 seconds);
}
```

**Task B - Meter (RS-485/Modbus):**
```c
while (1) {
    if (not low power) {
        modbus_rs485_read_state(&balance, &consumption);
        
        // Thread-safe update via semaphore
        xSemaphoreTake(meter_mutex, 100ms);
        g_meter_balance = balance;
        g_meter_consumption = consumption;
        xSemaphoreGive(meter_mutex);
        
        ESP_LOGI("Meter read: balance=%.2f consumption=%.2f", 
                 balance, consumption);
    }
    
    vTaskDelay(10 seconds);
}
```

**Task C - STS Engine (Token Processing):**
```c
while (1) {
    if (wifi_http_get_next_token(token)) {
        ESP_LOGI("Processing token: %s", token);
        
        // Submit to meter via Modbus write
        if (!sts_submit_token(token)) {
            ESP_LOGW("Token submission failed, will retry");
        }
    }
    
    vTaskDelay(500ms);
}
```

**Task D - Power Management:**
```c
while (1) {
    power_safety_tick();  // Check battery/AC
    
    if (low power) {
        hal_set_status_led(false);  // Turn off LED
    } else {
        hal_set_status_led(true);   // Green = healthy
    }
    
    vTaskDelay(2 seconds);
}
```

---

## Part 2: Device Operation Flow (End-to-End)

### 2.1 Boot Sequence

```
[POWER ON ESP32]
    ↓
[ROM Bootloader]
    → Loads IDF bootloader from partition 0x1000
    ↓
[IDF Bootloader]
    → Verifies app partition at 0x10000
    → Allocates heap
    → Loads user application
    ↓
[app_main() Initialization]
    1. NVS Flash Init (check for saved WiFi credentials)
    2. Event Loop Init (ESP events framework)
    3. HAL Init (GPIO, ADC, UART for RS-485)
    4. Power Safety Init (battery/AC detection)
    5. Create Mutex: g_meter_data_mutex (thread-safe meter data)
    6. Create 4 Tasks (A, B, C, D)
    ↓
[Provisioned Check]
    if (NVS["wifi"]["ssid"] exists) {
        STATE = "PROVISIONED" → WiFi STA mode
    } else {
        STATE = "UNPROVISIONED" → WiFi AP mode + BLE
    }
```

### 2.2 Unprovisioned Device Discovery (How App Finds Device)

**Method 1: WiFi AP Scan**
```
Device broadcasts:
├─ SSID: "Meqoniqs-Setup"
├─ IP: 192.168.4.1 (AP gateway)
├─ Port: 80 (HTTP)
└─ Password: "meqoniqs123"

User sees in phone WiFi list:
  ├─ Home WiFi
  ├─ Meqoniqs-Setup ← NEW DEVICE
  └─ Starbucks WiFi

User connects and opens app:
  App discovers: 192.168.4.1:80 is device
```

**Method 2: BLE Advertisement**
```
Device broadcasts:
├─ Device Name: "Meqoniqs-Setup"
├─ Service UUID: 0x00FF (custom provisioning)
├─ Characteristics:
│  ├─ 0xFF01 (SSID) - 32 bytes writable
│  └─ 0xFF02 (Password) - 64 bytes writable
└─ Advertising Type: Connectable

User sees in phone BLE list:
  ├─ Apple AirPods
  ├─ Meqoniqs-Setup ← NEW DEVICE (BLE)
  └─ Fitbit Band
```

### 2.3 Provisioning (Two Parallel Paths)

#### Path A: WiFi HTTP Provisioning
```
[User on home WiFi, opens app]
    ↓
[App connects to 192.168.4.1]
    ↓
[App detects current WiFi: "MyHomeNetwork"]
    ↓
[User confirms: load WiFi credentials to device]
    ↓
[App POST /wifi endpoint]
POST /wifi HTTP/1.1
Host: 192.168.4.1
Content-Type: application/json

{
  "ssid": "MyHomeNetwork",
  "password": "wifi_password_123"
}
    ↓
[ESP32 wifi_post_handler receives]
    1. Parse JSON (ssid, password)
    2. Save to NVS["wifi"]["ssid"] and NVS["wifi"]["password"]
    3. Set provisioned = true
    4. Stop WiFi AP mode
    5. esp_wifi_set_mode(WIFI_MODE_STA)
    6. esp_wifi_connect()
    7. Return HTTP 200: {"ok": true}
    ↓
[Device connects to home WiFi]
    ↓
[Event: IP_EVENT_STA_GOT_IP]
    current_ip = "192.168.1.42" (from home router)
    Task A now polls cloud every 60s
```

#### Path B: BLE Provisioning (Concurrent)
```
[User connects via BLE to Meqoniqs-Setup]
    ↓
[App writes SSID to characteristic 0xFF01]
GATT Write: 0xFF01 = "MyHomeNetwork"
    ↓
[ESP32 gatts_profile_event_handler]
    NVS["wifi"]["ssid"] = "MyHomeNetwork"
    ↓
[App writes Password to characteristic 0xFF02]
GATT Write: 0xFF02 = "wifi_password_123"
    ↓
[ESP32 gatts_profile_event_handler]
    NVS["wifi"]["password"] = "wifi_password_123"
    Set provisioned = true
    esp_wifi_set_mode(WIFI_MODE_STA)
    esp_wifi_connect()
    ↓
[Same as Path A: WiFi connects, IP assigned]
```

### 2.4 Post-Provisioning State

```
┌─────────────────────────────────────────┐
│  PROVISIONED DEVICE                     │
│  ✅ WiFi STA: Connected to home WiFi   │
│  ✅ IP: 192.168.1.42 (dynamic)         │
│  ✅ BLE: Still advertising             │
│  ✅ HTTP: Port 80 still listening      │
│  ✅ Task B: Meter readings every 10s   │
│  ✅ Task A: Cloud poll every 60s       │
│  ✅ Task C: Token processing ready     │
│  ✅ Task D: Power monitoring active    │
└─────────────────────────────────────────┘

Available Endpoints:
├─ GET /api/status → Returns device + meter info ✅ NEW
├─ POST /token → Receive tokens (local fallback)
├─ POST /api/status → Optional status logging
└─ (Device polls) GET /api/tokens/[deviceId]
```

---

## Part 3: Data Flow - From Device to Cloud

### 3.1 Cloud Polling Loop (Device Pulls Tokens)

**Every 60 Seconds:**

```
Task A (Connectivity):
    ↓
[Check: provisioned == true?]
    ↓
[Check: WiFi connected?]
    ↓
[Make HTTPS GET request]
GET https://meqoniqs-backend.vercel.app/api/tokens/2805A52FD478

Headers:
  Host: meqoniqs-backend.vercel.app
  User-Agent: ESP32/1.0
  Connection: close
    ↓
[Backend receives request]
    ↓
[Query: SELECT * FROM tokens_queue 
          WHERE device_id = '2805A52FD478' 
          AND dispatched_at IS NULL 
          ORDER BY created_at ASC LIMIT 1]
    ↓
[Response: Token Found]
HTTP/1.1 200 OK
Content-Type: application/json

{
  "token": "12345678901234567890"
}
    ↓
[Backend Update]
UPDATE tokens_queue SET dispatched_at = NOW() 
WHERE id = 'queue-id'
    ↓
[Device receives JSON]
    ↓
[Push token to queue]
token_queue ← "12345678901234567890"
    ↓
[Task C - STS Engine picks up token]
    ↓
[Submit to meter via Modbus RTU]
Modbus Write: Function 16 (0x10)
  Address: 0x5000
  Value: "12345678901234567890"
    ↓
[Meter processes token]
✅ Token applied
    ↓
[Device waits 60s for next poll]
```

**Response if No Token Pending:**
```
GET /api/tokens/2805A52FD478
    ↓
[Query finds nothing]
    ↓
HTTP/1.1 200 OK
Content-Type: application/json

{
  "empty": true
}
    ↓
[Device: No action, wait 60s for next poll]
```

### 3.2 Local Token Fallback (When Device is LAN-Accessible)

```
[Mobile App wants to send token immediately]
    ↓
[App discovers device IP: 192.168.1.42]
    ↓
[App tries local endpoint]
POST http://192.168.1.42/token
timeout: 3 seconds

{
  "token": "12345678901234567890"
}
    ↓
[Response Options]

CASE 1: Device responds within 3s ✅
{
  "ok": true,
  "message": "Token submitted to meter"
}
User sees: "✅ Token loaded instantly"
Token applied in < 1 second

CASE 2: Timeout or network error ❌
    ↓
[App falls back to cloud]
POST https://meqoniqs-backend.vercel.app/api/tokens
{
  "deviceId": "2805A52FD478",
  "token": "12345678901234567890",
  "userId": "user-uuid"
}
    ↓
[Backend enqueues token]
INSERT INTO tokens_queue (...)
    ↓
[Device polls 60s later and receives]
User sees: "⏱️ Token synced (device polled cloud)"
```

### 3.3 Device Status Reporting (Optional for Analytics)

```
Device can optionally report status POST-provisioning:

POST https://meqoniqs-backend.vercel.app/api/status

{
  "deviceId": "2805A52FD478",
  "ip": "192.168.1.42",
  "meter_number": "12345678",
  "balance": 1234.56,
  "consumption": 567.89,
  "battery_mv": 3700,
  "ac_present": true,
  "meterConnected": true,
  "firmware_version": "b8df4dc",
  "rssi": -45
}
    ↓
[Backend stores in status_logs]
INSERT INTO status_logs (id, device_id, battery_mv, ac_present, 
                         meter_connected, logged_at)
    ↓
[Backend updates devices table]
UPDATE devices SET last_seen = NOW(), ip_address = '192.168.1.42'
```

---

## Part 4: Database Structure & Data Persistence

### 4.1 Backend Database Schema (Neon PostgreSQL)

```sql
-- Primary Device Registry
CREATE TABLE devices (
  id VARCHAR(50) PRIMARY KEY,              -- "2805A52FD478" (device_id)
  user_id VARCHAR(100),                    -- UUID: links to user account
  meter_id VARCHAR(20),                    -- "12345678" (meter number)
  ip_address VARCHAR(15),                  -- "192.168.1.42"
  created_at TIMESTAMP DEFAULT NOW(),      -- Device first registered
  last_seen TIMESTAMP                      -- Last activity from device
);

-- Token Queue (Cloud Fallback)
CREATE TABLE tokens_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- Queue record ID
  device_id VARCHAR(50) REFERENCES devices(id),   -- Which device
  token VARCHAR(50),                              -- "12345678901234567890"
  created_at TIMESTAMP DEFAULT NOW(),             -- When queued
  dispatched_at TIMESTAMP,                        -- NULL until sent, then set
  INDEX idx_device_pending (device_id, dispatched_at)
);

-- Device Status Timeline (Optional Analytics)
CREATE TABLE status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id),
  battery_mv INT,                  -- Battery voltage in mV
  ac_present BOOLEAN,              -- Is AC connected?
  meter_connected BOOLEAN,         -- Is Modbus meter reachable?
  logged_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for Performance
CREATE INDEX idx_tokens_pending 
  ON tokens_queue(device_id, dispatched_at) 
  WHERE dispatched_at IS NULL;

CREATE INDEX idx_status_device ON status_logs(device_id);
CREATE INDEX idx_devices_user ON devices(user_id);
```

### 4.2 Device Firmware NVS Flash Storage

```
On-Device Flash (Non-Volatile Storage):

Namespace: "wifi"
├─ ssid[32]       = "MyHomeNetwork"
├─ password[64]   = "wifi_password_123"
└─ (future) rssi[4] = last RSSI value

Namespace: "device"
├─ device_id[12]  = "2805A52FD478" (MAC)
├─ meter_number[16] = "12345678"
├─ provisioned_at[8] = Unix timestamp
└─ fw_version[32] = "b8df4dc"

Namespace: "meter" (Recommended to add)
├─ last_balance[4]       = 1234.56 (float)
├─ last_consumption[4]   = 567.89 (float)
└─ last_read_time[8]     = Unix timestamp
```

### 4.3 Device Memory (RAM Cache)

```
Runtime Variables (FreeRTOS Shared Memory):

Global Variables:
├─ g_meter_balance (float)        ← Updated by Task B every 10s
├─ g_meter_consumption (float)    ← Updated by Task B every 10s
├─ g_meter_data_mutex (semaphore) ← Protects above
├─ provisioned (bool)             ← false until credentials saved
├─ current_ip (char[16])          ← IP from event loop
├─ ssid (char[32])               ← Cached WiFi SSID
├─ password (char[64])           ← Cached WiFi password
└─ token_queue (FreeRTOS Queue)  ← Tokens from cloud or local

Token Queue:
├─ Size: Up to N tokens can queue
├─ Populated by: Task A (cloud poll) or HTTP POST /token
├─ Consumed by: Task C (STS engine)
└─ Behavior: FIFO (First In First Out)
```

---

## Part 5: Data Synchronization Strategy

### 5.1 Current Data Flow Diagram

```
┌──────────────────────────────┐
│  Device (NVS Flash)          │
│                              │
│ ✅ WiFi credentials (local)  │
│ ✅ Meter number (cached)     │
│ ✅ Device ID (MAC-based)     │
│ ✅ Meter balance (cached 10s)│
│ ✅ Meter consumption (cached)│
└──────────┬───────────────────┘
           │ (Polls every 60s)
           ↓
┌──────────────────────────────────────────┐
│  Backend Database (Neon PostgreSQL)      │
│                                          │
│ devices:                                 │
│ ├─ device_id (PK)                       │
│ ├─ user_id (FK to users table)          │
│ ├─ meter_id                             │
│ ├─ ip_address                           │
│ ├─ created_at                           │
│ └─ last_seen                            │
│                                          │
│ tokens_queue:                           │
│ ├─ id (PK)                              │
│ ├─ device_id (FK)                       │
│ ├─ token                                │
│ ├─ created_at                           │
│ └─ dispatched_at (NULL until sent)      │
│                                          │
│ status_logs: (optional analytics)       │
│ ├─ id                                   │
│ ├─ device_id (FK)                       │
│ ├─ battery_mv                           │
│ ├─ ac_present                           │
│ ├─ meter_connected                      │
│ └─ logged_at                            │
└──────────┬───────────────────────────────┘
           │
           ↓
┌──────────────────────────────┐
│  App Backend (Neon)          │
│                              │
│ (Your application database)  │
│                              │
│ users table                  │
│ devices table                │
│ consumption table            │
│ transactions table           │
│ ...                          │
└──────────────────────────────┘
```

### 5.2 Database Harmonization Options

#### Option A: Unified Database (RECOMMENDED FOR SYNCHRONIZATION)

**Architecture:**
```
Single Neon Database with unified schema:

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255),
  created_at TIMESTAMP
);

CREATE TABLE meqoniqs_devices (
  id VARCHAR(50) PRIMARY KEY,         -- device_id
  user_id UUID REFERENCES users(id),
  meter_id VARCHAR(20),
  ip_address VARCHAR(15),
  firmware_version VARCHAR(32),
  status ENUM('active', 'inactive', 'error'),
  battery_mv INT,
  ac_present BOOLEAN,
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE meqoniqs_tokens (
  id UUID PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES meqoniqs_devices(id),
  token VARCHAR(50),
  status ENUM('pending', 'dispatched', 'applied'),
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE consumption_data (
  id UUID PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES meqoniqs_devices(id),
  balance DECIMAL(10,2),
  consumption DECIMAL(10,2),
  recorded_at TIMESTAMP DEFAULT NOW(),
  source ENUM('device_poll', 'api_status', 'meter_read')
);

CREATE TABLE device_status_logs (
  id UUID PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES meqoniqs_devices(id),
  status_json JSONB,              -- Flexible status data
  logged_at TIMESTAMP DEFAULT NOW()
);
```

**Advantages:**
- ✅ Single source of truth
- ✅ Foreign keys enforce data consistency
- ✅ ACID transactions across tables
- ✅ Easier joins between app data and device data
- ✅ No data duplication
- ✅ Simpler sync logic

**Disadvantages:**
- Migration needed if schemas differ
- Must handle schema conflicts

#### Option B: Separate Databases with Sync Triggers

**Architecture:**
```
Device Backend Database:
├─ devices
├─ tokens_queue
└─ status_logs

App Backend Database:
├─ users
├─ app_devices
├─ app_consumption
└─ app_transactions

Sync Layer (Webhook/Message Queue):
├─ When device created → POST to app backend
├─ When token applied → POST status to app backend
├─ When consumption updated → POST to app backend
└─ App backend updates its own device registry
```

**Implementation:**
```javascript
// After device registers or token applies
// Meqoniqs backend sends webhook to app backend:

POST https://app-backend.com/api/meqoniqs/sync

{
  "event": "device_status_updated",
  "device_id": "2805A52FD478",
  "data": {
    "meter_id": "12345678",
    "balance": 1234.56,
    "consumption": 567.89,
    "rssi": -45,
    "last_seen": "2026-03-30T10:15:00Z"
  }
}
```

**Advantages:**
- ✅ Loose coupling between systems
- ✅ Each backend stays independent
- ✅ Scales better for distributed systems
- ✅ Gradual migration possible

**Disadvantages:**
- ❌ Eventual consistency (eventual sync delays)
- ❌ More complex error handling
- ❌ Webhook delivery uncertainty

#### Option C: App Backend Queries Device Backend (Recommended for MVP)

**Architecture:**
```
App Backend:
└─ On demand queries device backend:

GET https://meqoniqs-backend.vercel.app/api/devices/[userId]
  ↓
Returns all devices for user
  ↓
App backend caches result
  ↓
On each user action, app syncs device state
```

**Implementation:**
```javascript
// In app backend, when user logs in or views devices:

const devices = await fetch(
  `https://meqoniqs-backend.vercel.app/api/devices?userId=${userId}`
);
// Returns [{ id, meter_id, balance, consumption, rssi, ... }]

// Cache in app database or return directly
UPDATE app_devices SET ... WHERE user_id = userId
```

**Advantages:**
- ✅ Simplest to implement
- ✅ No duplicate storage
- ✅ Real-time data always current
- ✅ Good for MVP/prototyping

**Disadvantages:**
- ❌ Depends on device backend availability
- ❌ Every query adds latency
- ❌ Network dependency

---

## Part 6: Recommended Harmonization Strategy

### 6.1 For Your Use Case (Single Company, Two Projects)

**Recommendation: OPTION A (Unified Database) + LOCAL MIRRORING**

**Implementation Plan:**

```
Phase 1: Schema Audit
├─ Document your app backend schema
├─ Document device backend schema
├─ Identify overlaps (devices, user refs, consumption)
└─ Plan schema merge

Phase 2: Create Extended Schema in Neon
┌─────────────────────────────────────┐
│  Single Neon Database               │
│                                     │
│  App Tables (existing):             │
│  ├─ users                           │
│  ├─ app_devices                     │
│  ├─ consumption                     │
│  └─ transactions                    │
│                                     │
│  Device Tables (import):            │
│  ├─ meqoniqs_devices                │
│  ├─ meqoniqs_tokens                 │
│  ├─ meqoniqs_status_logs            │
│  └─ meqoniqs_consumption_metrics    │
│                                     │
│  Bridge Tables (foreign keys):      │
│  ├─ user_id → users.id              │
│  ├─ device_id → meqoniqs_devices.id │
│  └─ Unified audit trail             │
└─────────────────────────────────────┘

Phase 3: Modify Meqoniqs Backend
├─ Change database connection to single Neon pool
├─ Update schema references (add "meqoniqs_" prefix)
├─ Update API endpoints to match
└─ Deploy to Vercel

Phase 4: Keep Device Backend as Source of Truth
├─ Device backend polls cloud every 60s
├─ Device backend inserts/updates meqoniqs_* tables
├─ App backend reads meqoniqs_* tables as needed
├─ App backend updates app_* tables based on meqoniqs_* data
└─ No two-way sync needed

Phase 5: Migration & Testing
├─ Test all endpoints
├─ Verify device provisions correctly
├─ Verify tokens queue and dispatch
├─ Verify app can read device data
└─ Monitor for 1 week
```

### 6.2 Schema Merger Example

**Your App Tables:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_devices (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  device_identifier VARCHAR(100),
  device_type VARCHAR(50),
  created_at TIMESTAMP
);
```

**Merged Schema (Single Database):**
```sql
-- Keep your existing tables as-is
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Now add Meqoniqs-specific device info
CREATE TABLE meqoniqs_devices (
  id VARCHAR(50) PRIMARY KEY,              -- device_id from ESP32
  
  -- Link to your app
  user_id UUID REFERENCES users(id),
  
  -- Device identifiers
  device_name VARCHAR(100),                -- "Meqoniqs-Setup"
  meter_id VARCHAR(20),                    -- Meter identifier
  meter_number VARCHAR(20),                -- Meter number
  
  -- Device state
  ip_address VARCHAR(15),
  firmware_version VARCHAR(32),
  battery_mv INT,
  ac_present BOOLEAN,
  meter_connected BOOLEAN,
  rssi INT,                                -- WiFi signal strength
  
  -- Last activity
  last_seen TIMESTAMP,
  last_status_update TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Real-time meter data (keep latest)
CREATE TABLE meqoniqs_meter_state (
  device_id VARCHAR(50) PRIMARY KEY REFERENCES meqoniqs_devices(id),
  balance DECIMAL(10,2),
  consumption DECIMAL(10,2),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Historical consumption (for charts/analytics)
CREATE TABLE meqoniqs_consumption_history (
  id UUID PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES meqoniqs_devices(id),
  balance DECIMAL(10,2),
  consumption DECIMAL(10,2),
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- Token management
CREATE TABLE meqoniqs_tokens (
  id UUID PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES meqoniqs_devices(id),
  user_id UUID REFERENCES users(id),
  token VARCHAR(50),
  
  status ENUM('queued', 'dispatched', 'applied', 'failed'),
  created_at TIMESTAMP DEFAULT NOW(),
  dispatched_at TIMESTAMP,
  applied_at TIMESTAMP,
  error_message VARCHAR(255)
);

-- Status/diagnostics log
CREATE TABLE meqoniqs_status_logs (
  id UUID PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES meqoniqs_devices(id),
  status_jsonb JSONB,     -- Flexible status data
  logged_at TIMESTAMP DEFAULT NOW()
);
```

### 6.3 Updated Meqoniqs Backend (Using Unified Database)

**Before (Separate Database):**
```javascript
// api/tokens/[deviceId].js
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { deviceId } = req.query;
  
  if (req.method === 'GET') {
    const result = await sql`
      SELECT id, token FROM tokens_queue 
      WHERE device_id = ${deviceId} AND dispatched_at IS NULL 
      LIMIT 1
    `;
    
    if (result.rows.length === 0) {
      return res.json({ empty: true });
    }
    
    const token = result.rows[0];
    await sql`UPDATE tokens_queue SET dispatched_at = NOW() WHERE id = ${token.id}`;
    
    return res.json({ token: token.token });
  }
}
```

**After (Unified Database):**
```javascript
// api/tokens/[deviceId].js
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { deviceId } = req.query;
  
  if (req.method === 'GET') {
    // Same query, table name just clarified
    const result = await sql`
      SELECT id, token FROM meqoniqs_tokens 
      WHERE device_id = ${deviceId} 
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    `;
    
    if (result.rows.length === 0) {
      return res.json({ empty: true });
    }
    
    const tokenRecord = result.rows[0];
    
    // Update status to 'dispatched'
    await sql`
      UPDATE meqoniqs_tokens 
      SET status = 'dispatched', dispatched_at = NOW() 
      WHERE id = ${tokenRecord.id}
    `;
    
    // Update device last_seen
    await sql`
      UPDATE meqoniqs_devices 
      SET last_seen = NOW() 
      WHERE id = ${deviceId}
    `;
    
    return res.json({ token: tokenRecord.token });
  }
}
```

### 6.4 App Backend Integration

**New Endpoint: Get Device With Consumption Data**
```javascript
// pages/api/devices/[deviceId].js
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { deviceId } = req.query;
  
  // Get device info from meqoniqs_devices
  const device = await sql`
    SELECT 
      md.id, md.user_id, md.meter_id, md.ip_address,
      md.firmware_version, md.rssi, md.last_seen,
      mms.balance, mms.consumption, mms.updated_at
    FROM meqoniqs_devices md
    LEFT JOIN meqoniqs_meter_state mms ON md.id = mms.device_id
    WHERE md.id = ${deviceId}
  `;
  
  if (device.rows.length === 0) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  return res.json(device.rows[0]);
}

// Now your app can:
// GET /api/devices/2805A52FD478
// Returns: {
//   id: '2805A52FD478',
//   meter_id: '12345678',
//   ip_address: '192.168.1.42',
//   balance: 1234.56,
//   consumption: 567.89,
//   last_seen: '2026-03-30T10:15:00Z',
//   ...
// }
```

---

## Part 7: Data Consistency & Sync Guarantees

### 7.1 Current Guarant ies

```
Device → Backend Consistency:

1. Device ID (MAC-based)
   ├─ Device: Stored in memory at boot (wifi_http.c)
   ├─ Backend: Included in every cloud poll request
   ├─ Consistency: ✅ Permanent (MAC never changes)

2. Meter Number
   ├─ Device: Read from Modbus meter every 10s
   ├─ Backend: Received in /api/status via device POST
   ├─ Consistency: ✅ Always current (10s lag max)
   ├─ Sync: Manual POST required (optional)

3. Tokens
   ├─ Device: Polls every 60s → receives → processes
   ├─ Backend: Queue marked 'dispatched' once given to device
   ├─ Consistency: ✅ Tokens never duplicated (dispatched_at IS NULL logic)
   ├─ Guarantee: Exactly-once token delivery

4. Device Last Seen
   ├─ Device: Polls every 60s
   ├─ Backend: Updated on every cloud poll
   ├─ Consistency: ✅ Within 60s of device being alive
```

### 7.2 Eventual Consistency Strategy

```
For consumption_data (not time-critical):

Device (every 10s):
  g_meter_balance = 1234.56
  g_meter_consumption = 567.89
  
↓ (When device calls /api/status)

App makes GET /api/status (can call anytime):
  {
    "balance": 1234.56,
    "consumption": 567.89,
    ...
  }
  
↓ (App records in meqoniqs_meter_state)

Database:
  INSERT INTO meqoniqs_consumption_history
  VALUES (..., 1234.56, 567.89, NOW())

Result:
  Data is current within seconds of device measurement
  Historical data stored forever
```

---

## Part 8: Migration Checklist

### 8.1 Step-by-Step Harmonization

- **Step 1:** [ ] Audit both database schemas
- **Step 2:** [ ] Design merged schema (document conflicts)
- **Step 3:** [ ] Create extended schema in Neon (add meqoniqs_* tables)
- **Step 4:** [ ] Update Meqoniqs backend /api/* to use meqoniqs_* tables
- **Step 5:** [ ] Test device provisioning → token poll → token delivery
- **Step 6:** [ ] Add GET endpoints for app backend to query device status
- **Step 7:** [ ] Update app backend to join user + meqoniqs_devices for app UI
- **Step 8:** [ ] Test end-to-end: Device → provisions → cloud → app displays
- **Step 9:** [ ] Monitor logs for 1 week (check for sync issues)
- **Step 10:** [ ] Decommission separate device database (if using one)

### 8.2 Rollback Plan

```
If issues occur:

1. Keep old schema in new database (or keep old database)
2. Add migration flag to code
3. If new code fails, switch back to old queries
4. Debug, fix, redeploy
5. Gradually migrate data if needed
```

---

## Summary: Recommended Path Forward

**For Your Dual-Project Setup (Meqoniqs Device + App Application):**

1. **Use Single Neon Database** with meqoniqs_* table prefix
2. **Keep Device Backend as Source of Truth** for device data
3. **Have App Backend Query Device Data** as needed via single DB
4. **Implement Foreign Keys** to users table in app
5. **No Webhook/Message Queue Needed** (same DB = strong consistency)
6. **Real-Time Sync** because both apps read same database

**Benefits:**
- ✅ Single source of truth
- ✅ ACID transactions across devices and app data
- ✅ Referential integrity (foreign keys)
- ✅ Simpler operational complexity
- ✅ No eventual consistency issues
- ✅ Easy to add more tables later

**Data Flow After Harmonization:**
```
ESP32 Device ←→ Meqoniqs Backend
        ↓
   Single Neon Database
        ↓
   App Backend ←→ Mobile App
```

---

## Appendix: Complete API Endpoint Reference

### Device Endpoints (From ESP32)

| Endpoint | Method | Source | Purpose |
|----------|--------|--------|---------|
| `/wifi` | POST | Unprovisioned app | Receive WiFi credentials |
| `/token` | POST | App (local) | Receive token immediately |
| `/status` | GET | App | Check device status |
| `/api/status` | GET | App | Complete device + meter info |

### Cloud Endpoints (Polled by Device)

| Endpoint | Method | Caller | Purpose |
|----------|--------|--------|---------|
| `/api/tokens` | POST | App | Queue token for device |
| `/api/tokens/[deviceId]` | GET | Device | Poll for pending tokens |
| `/api/status` | POST | Device | Optional status report |
| `/api/devices` | POST | Device | Register device |

### App Backend Endpoints (For Frontend)

| Endpoint | Method | Caller | Purpose |
|----------|--------|--------|---------|
| `/api/devices` | GET | App | List user's devices |
| `/api/devices/[deviceId]` | GET | App | Get device + meter state |
| `/api/devices/[deviceId]/tokens` | POST | App | Queue token for device |
| `/api/devices/[deviceId]/consumption` | GET | App | Get consumption history |

---

**Document Version:** 1.0  
**Last Updated:** 2026-03-30  
**Status:** Complete Architecture + Harmonization Strategy

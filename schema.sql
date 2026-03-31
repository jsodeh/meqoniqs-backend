-- Unified MetroPush + Meqoniqs Database Schema
-- Run this in your Neon PostgreSQL database to set up the unified meqoniqs_* tables
-- Date: 31 March 2026

-- Create ENUM for token status lifecycle
CREATE TYPE meqoniqs_token_status AS ENUM ('queued', 'dispatched', 'applied', 'failed');

-- Main devices table - stores all IoT devices
CREATE TABLE IF NOT EXISTS meqoniqs_devices (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(100),
  meter_id VARCHAR(20),
  meter_number VARCHAR(30),
  device_name VARCHAR(100) DEFAULT 'Meqoniqs Device',
  ip_address VARCHAR(15),
  battery_mv INT,
  ac_present BOOLEAN DEFAULT false,
  meter_connected BOOLEAN DEFAULT false,
  firmware_version VARCHAR(20),
  rssi INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token queue table - tracks tokens waiting to be delivered to devices
CREATE TABLE IF NOT EXISTS meqoniqs_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) NOT NULL REFERENCES meqoniqs_devices(id) ON DELETE CASCADE,
  user_id VARCHAR(100),
  token VARCHAR(50) NOT NULL,
  status meqoniqs_token_status DEFAULT 'queued',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMP,
  applied_at TIMESTAMP,
  CONSTRAINT valid_token_length CHECK (LENGTH(token) = 20)
);

-- Meter state table - stores current meter balance and consumption
CREATE TABLE IF NOT EXISTS meqoniqs_meter_state (
  device_id VARCHAR(50) PRIMARY KEY REFERENCES meqoniqs_devices(id) ON DELETE CASCADE,
  balance NUMERIC(10, 2) DEFAULT 0.00,
  consumption NUMERIC(12, 2) DEFAULT 0.00,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Status logs table - historical tracking of device status and meter data
CREATE TABLE IF NOT EXISTS meqoniqs_status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) NOT NULL REFERENCES meqoniqs_devices(id) ON DELETE CASCADE,
  user_id VARCHAR(100),
  battery_mv INT,
  ac_present BOOLEAN,
  meter_connected BOOLEAN,
  meter_number VARCHAR(30),
  balance NUMERIC(10, 2),
  consumption NUMERIC(12, 2),
  rssi INT,
  firmware_version VARCHAR(20),
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for optimal query performance
CREATE INDEX IF NOT EXISTS idx_meqoniqs_devices_user ON meqoniqs_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_meqoniqs_devices_last_seen ON meqoniqs_devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_meqoniqs_tokens_pending ON meqoniqs_tokens(device_id, status) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_meqoniqs_tokens_device ON meqoniqs_tokens(device_id);
CREATE INDEX IF NOT EXISTS idx_meqoniqs_tokens_user ON meqoniqs_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_meqoniqs_status_logs_device ON meqoniqs_status_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_meqoniqs_status_logs_user ON meqoniqs_status_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_meqoniqs_status_logs_time ON meqoniqs_status_logs(logged_at);

-- Create view for recent device status
CREATE OR REPLACE VIEW meqoniqs_device_status AS
SELECT 
  md.id,
  md.user_id,
  md.device_name,
  md.meter_number,
  md.battery_mv,
  md.ac_present,
  md.meter_connected,
  md.firmware_version,
  md.rssi,
  md.last_seen,
  CASE 
    WHEN md.last_seen > NOW() - INTERVAL '5 minutes' THEN 'online'
    WHEN md.last_seen > NOW() - INTERVAL '24 hours' THEN 'recently_online'
    ELSE 'offline'
  END as status,
  mms.balance,
  mms.consumption,
  mms.updated_at as meter_updated_at
FROM meqoniqs_devices md
LEFT JOIN meqoniqs_meter_state mms ON md.id = mms.device_id;

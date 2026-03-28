-- MetroPush Backend Database Schema
-- Run this in your Vercel PostgreSQL database

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(100),
  meter_id VARCHAR(20),
  ip_address VARCHAR(15),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tokens_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
  token VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMP,
  INDEX idx_device_pending (device_id, dispatched_at)
);

CREATE TABLE IF NOT EXISTS status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
  battery_mv INT,
  ac_present BOOLEAN,
  meter_connected BOOLEAN,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_device_time (device_id, logged_at)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tokens_pending ON tokens_queue(device_id, dispatched_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_status_device ON status_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

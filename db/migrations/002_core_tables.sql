-- Migration 002: Core application tables

-- Users and settings
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) PRIMARY KEY,
  v TEXT
);

-- Batches
CREATE TABLE IF NOT EXISTS batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  ncs_version_id INT NOT NULL,
  start_date DATE NOT NULL,
  planned_months INT NOT NULL DEFAULT 6,
  month_mode ENUM('batch','calendar') NOT NULL DEFAULT 'batch',
  target_hours_per_month INT NOT NULL DEFAULT 120,
  status ENUM('active','completed','archived') NOT NULL DEFAULT 'active',
  FOREIGN KEY (ncs_version_id) REFERENCES ncs_versions(id)
);

-- Weekly teaching pattern
CREATE TABLE IF NOT EXISTS batch_week_pattern (
  batch_id INT NOT NULL,
  weekday TINYINT NOT NULL,
  hours DECIMAL(3,1) NOT NULL DEFAULT 0,
  start_time TIME NULL,
  end_time TIME NULL,
  PRIMARY KEY (batch_id, weekday),
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

-- Per-batch module order and hours
CREATE TABLE IF NOT EXISTS batch_modules (
  batch_id INT NOT NULL,
  module_id INT NOT NULL,
  teach_order INT NOT NULL,
  theory_hours INT NOT NULL,
  practical_hours INT NOT NULL,
  hours_already_done DECIMAL(5,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, module_id),
  FOREIGN KEY (batch_id) REFERENCES batches(id),
  FOREIGN KEY (module_id) REFERENCES modules(id)
);

-- Task weights inside a module
CREATE TABLE IF NOT EXISTS batch_task_weights (
  batch_id INT NOT NULL,
  task_id INT NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (batch_id, task_id),
  FOREIGN KEY (batch_id) REFERENCES batches(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  reg_no VARCHAR(30),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('active','dropped') NOT NULL DEFAULT 'active',
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

-- Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hdate DATE NOT NULL,
  name VARCHAR(150) NOT NULL,
  type ENUM('public','poya','bank','mercantile','institute_closure','other') NOT NULL,
  is_off TINYINT(1) NOT NULL DEFAULT 1,
  source VARCHAR(200),
  verified TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_holiday (hdate, name)
);

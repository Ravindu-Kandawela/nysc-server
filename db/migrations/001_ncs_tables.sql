-- Migration 001: NCS reference tables (populated by seed)
-- These tables store the National Competency Standard data

CREATE TABLE IF NOT EXISTS ncs_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  revision_date DATE,
  total_hours INT NOT NULL DEFAULT 720,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ncs_version_id INT NOT NULL,
  code VARCHAR(10) NOT NULL,
  title VARCHAR(200) NOT NULL,
  theory_hours INT NOT NULL DEFAULT 0,
  practical_hours INT NOT NULL DEFAULT 0,
  teach_order INT NOT NULL DEFAULT 0,
  has_checklist TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (ncs_version_id) REFERENCES ncs_versions(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module_id INT NOT NULL,
  code VARCHAR(10) NOT NULL,
  title VARCHAR(300) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (module_id) REFERENCES modules(id)
);

CREATE TABLE IF NOT EXISTS steps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  code VARCHAR(15) NOT NULL,
  title VARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Migration 003: Plan, attendance, diary, checklists, assignments, reports

-- Lesson plan versions
CREATE TABLE IF NOT EXISTS plan_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  version_no INT NOT NULL,
  reason VARCHAR(255),
  effective_from DATE NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

-- Plan sessions (one row = one chunk of teaching on one date)
CREATE TABLE IF NOT EXISTS plan_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_version_id INT NOT NULL,
  batch_id INT NOT NULL,
  sdate DATE NOT NULL,
  seq INT NOT NULL,
  module_id INT NOT NULL,
  task_id INT NULL,
  hours DECIMAL(4,1) NOT NULL,
  kind ENUM('theory','practical','mixed') NOT NULL DEFAULT 'mixed',
  topic_text VARCHAR(500),
  INDEX (batch_id, sdate),
  FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id),
  FOREIGN KEY (module_id) REFERENCES modules(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Day log (what actually happened)
CREATE TABLE IF NOT EXISTS day_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  ldate DATE NOT NULL,
  status ENUM('taught','teacher_absent','institute_closed','partial',
              'assessment_day','substitute') NOT NULL,
  reason VARCHAR(255),
  hours_delivered DECIMAL(4,1) NOT NULL DEFAULT 0,
  substitute_name VARCHAR(100),
  notes TEXT,
  UNIQUE KEY uq_day (batch_id, ldate),
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  student_id INT NOT NULL,
  adate DATE NOT NULL,
  status ENUM('P','A','L','E') NOT NULL,
  note VARCHAR(200),
  UNIQUE KEY uq_att (student_id, adate),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

-- Daily diary
CREATE TABLE IF NOT EXISTS diary_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  ddate DATE NOT NULL,
  summary_text TEXT,
  activities_text TEXT,
  remarks TEXT,
  hours_delivered DECIMAL(4,1) NOT NULL DEFAULT 0,
  time_text VARCHAR(40) NULL,
  students_present INT,
  students_total INT,
  status ENUM('draft','confirmed','printed') NOT NULL DEFAULT 'draft',
  generated_from_plan_version INT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_diary (batch_id, ddate),
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

CREATE TABLE IF NOT EXISTS diary_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diary_id INT NOT NULL,
  module_id INT,
  task_id INT,
  hours DECIMAL(4,1) NOT NULL,
  line_text VARCHAR(600),
  FOREIGN KEY (diary_id) REFERENCES diary_entries(id) ON DELETE CASCADE
);

-- Checklists
CREATE TABLE IF NOT EXISTS checklist_results (
  student_id INT NOT NULL,
  step_id INT NOT NULL,
  attempt TINYINT NOT NULL,
  achieved TINYINT(1) NOT NULL DEFAULT 0,
  assessed_on DATE,
  PRIMARY KEY (student_id, step_id, attempt),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (step_id) REFERENCES steps(id)
);

CREATE TABLE IF NOT EXISTS task_competency (
  student_id INT NOT NULL,
  task_id INT NOT NULL,
  competent TINYINT(1) NOT NULL DEFAULT 0,
  competent_date DATE,
  PRIMARY KEY (student_id, task_id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Audit trail for re-planning
CREATE TABLE IF NOT EXISTS schedule_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  change_date DATE NOT NULL,
  change_type VARCHAR(40) NOT NULL,
  from_plan_version INT,
  to_plan_version INT,
  hours_lost DECIMAL(4,1),
  details JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Assignments
CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  module_id INT NOT NULL,
  task_id INT NULL,
  title VARCHAR(200) NOT NULL,
  instructions TEXT,
  attachment_path VARCHAR(300),
  due_at DATETIME NOT NULL,
  max_marks INT NOT NULL DEFAULT 100,
  allow_resubmit TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('draft','published','closed') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batches(id),
  FOREIGN KEY (module_id) REFERENCES modules(id)
);

CREATE TABLE IF NOT EXISTS assignment_recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  student_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  email_status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  email_error VARCHAR(300),
  emailed_at DATETIME,
  first_opened_at DATETIME,
  UNIQUE KEY uq_recipient (assignment_id, student_id),
  UNIQUE KEY uq_token (token_hash),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient_id INT NOT NULL,
  attempt_no INT NOT NULL DEFAULT 1,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_late TINYINT(1) NOT NULL DEFAULT 0,
  text_answer TEXT,
  file_path VARCHAR(300),
  file_name VARCHAR(200),
  file_size INT,
  FOREIGN KEY (recipient_id) REFERENCES assignment_recipients(id)
);

CREATE TABLE IF NOT EXISTS grades (
  submission_id INT PRIMARY KEY,
  result ENUM('correct','partly','incorrect','redo') NOT NULL,
  marks DECIMAL(5,1),
  feedback TEXT,
  graded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

-- Monthly reports
CREATE TABLE IF NOT EXISTS monthly_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  version_no INT NOT NULL DEFAULT 1,
  status ENUM('draft','confirmed','printed') NOT NULL DEFAULT 'draft',
  snapshot JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

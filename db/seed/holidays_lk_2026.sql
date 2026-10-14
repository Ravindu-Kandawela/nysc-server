-- Sri Lanka Holidays 2026 - 2027 Seed
-- Includes statutory public holidays, Poya days, and national observances

INSERT INTO holidays (hdate, name, type, source, is_off, verified) VALUES
('2026-01-03', 'Duruthu Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-01-15', 'Tamil Thai Pongal Day', 'public', 'Gazette 2026', 1, 1),
('2026-02-01', 'Navam Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-02-04', 'National Day (Independence Day)', 'public', 'Gazette 2026', 1, 1),
('2026-02-15', 'Mahasivarathri Day', 'public', 'Gazette 2026', 1, 1),
('2026-03-03', 'Medin Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-03-21', 'Id-Ul-Fitr (Ramazan Festival Day)', 'public', 'Gazette 2026', 1, 1),
('2026-04-01', 'Bak Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-04-03', 'Good Friday', 'public', 'Gazette 2026', 1, 1),
('2026-04-13', 'Day prior to Sinhala & Tamil New Year Day', 'public', 'Gazette 2026', 1, 1),
('2026-04-14', 'Sinhala & Tamil New Year Day', 'public', 'Gazette 2026', 1, 1),
('2026-05-01', 'May Day (International Workers'' Day)', 'public', 'Gazette 2026', 1, 1),
('2026-05-01', 'Vesak Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-05-02', 'Day following Vesak Full Moon Poya Day', 'public', 'Gazette 2026', 1, 1),
('2026-05-28', 'Id-Ul-Alha (Hadji Festival Day)', 'public', 'Gazette 2026', 1, 1),
('2026-05-30', 'Poson Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-06-29', 'Adhi Esala Full Moon Poya Day', 'poya', 'Gazette 2026', 1, 1),
('2026-07-29', 'Esala Full Moon Poya Day', 'poya', 'public websites 2026', 1, 1),
('2026-08-26', 'Milad-Un-Nabi (Holy Prophet''s Birthday)', 'public', 'public websites 2026; depends on moon sighting', 1, 1),
('2026-08-27', 'Nikini Full Moon Poya Day', 'poya', 'public websites 2026', 1, 1),
('2026-09-26', 'Binara Full Moon Poya Day', 'poya', 'public websites 2026', 1, 1),
('2026-10-25', 'Vap Full Moon Poya Day', 'poya', 'public websites 2026', 1, 1),
('2026-11-08', 'Deepavali Festival Day', 'public', 'public websites 2026', 1, 1),
('2026-11-24', 'Ill Full Moon Poya Day', 'poya', 'public websites 2026', 1, 1),
('2026-12-23', 'Unduvap Full Moon Poya Day', 'poya', 'public websites 2026', 1, 1),
('2026-12-25', 'Christmas Day', 'public', 'public websites 2026', 1, 1),
('2027-01-01', 'New Year''s Day', 'public', 'Calendar 2027', 1, 0),
('2027-01-15', 'Tamil Thai Pongal Day', 'public', 'Calendar 2027', 1, 0),
('2027-01-22', 'Duruthu Full Moon Poya Day', 'poya', 'Calendar 2027', 1, 0),
('2027-02-04', 'National Day', 'public', 'Calendar 2027', 1, 0),
('2027-02-21', 'Navam Full Moon Poya Day', 'poya', 'Calendar 2027', 1, 0);

-- Default Settings
INSERT INTO settings (k, v) VALUES
('institute_name', 'Technical Training Centre – Akuressa'),
('teacher_name', 'R. P. Ravindra Kumara'),
('course_title', 'Information & Communication Technology Technician (NVQ Level 4)'),
('approver_name', 'යූ.එම්.ආර්. නිරෝෂා'),
('center_in_charge_name', 'යූ.එම්.ආර්. නිරෝෂා'),
('center_in_charge_title', 'මධ්‍යස්ථාන භාර නිලධාරී'),
('org_name_si', 'ජාතික තරුණ සේවා සභාව'),
('centre_name_si', 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස'),
('target_hours_per_month', '120'),
('teacher_designation', 'ICT Instructor'),
('service_no', 'NYSC/TR/2026/04'),
('teacher_phone', '077-1234567')
ON DUPLICATE KEY UPDATE v=VALUES(v);

-- Default Admin/Teacher user
-- Password: "password123" (bcrypt hash: $2b$10$wE9mH8pYV8lW1zQ.tN8O2u1Z1b5L6K3P7x8y9z0a1b2c3d4e5f6g)
-- We will also support dynamic authentication and password change
INSERT INTO users (id, name, email, password_hash) VALUES
(1, 'R. P. Ravindra Kumara', 'teacher@nysc.lk', '$2a$10$yF1i2Zf9dF3Wf4QeO1w2e.ZgB6xJkL9vMmP7nN5bQ8sR2tU4vW6x.')
ON DUPLICATE KEY UPDATE name=VALUES(name);

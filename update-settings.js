const db = require('./src/db');

async function update() {
  const cleanSettings = [
    { k: 'teacher_name', v: '' },
    { k: 'teacher_phone', v: '' },
    { k: 'service_no', v: '' },
    { k: 'teacher_designation', v: 'ICT Instructor' },
    { k: 'approver_name', v: 'යූ.එම්.ආර්. නිරෝෂා' },
    { k: 'center_in_charge_name', v: 'යූ.එම්.ආර්. නිරෝෂා' },
    { k: 'center_in_charge_title', v: 'මධ්‍යස්ථාන භාර නිලධාරී' },
    { k: 'centre_name_si', v: 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස' },
    { k: 'org_name_si', v: 'ජාතික තරුණ සේවා සභාව' },
    { k: 'institute_name', v: 'Technical Training Centre – Akuressa' },
    { k: 'course_title', v: 'Information & Communication Technology Technician (NVQ Level 4)' },
    { k: 'target_hours_per_month', v: '120' }
  ];

  for (const s of cleanSettings) {
    await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [s.k, s.v]);
  }
  console.log('Settings updated with proper UTF-8!');
  process.exit(0);
}

update();

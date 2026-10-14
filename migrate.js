'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function runMigrations() {
  const isRemoteHost = process.env.DB_HOST && !['localhost', '127.0.0.1'].includes(process.env.DB_HOST);
  const useSSL = process.env.DB_SSL === 'true' || (process.env.DB_SSL !== 'false' && isRemoteHost);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234',
    database: process.env.DB_NAME || 'nysc_records',
    port: Number(process.env.DB_PORT) || 3306,
    multipleStatements: true,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined
  });

  console.log('Connected to MySQL. Running migrations...');

  try {
    // Ensure _migrations table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    let migrationsDir = path.join(__dirname, 'db/migrations');
    if (!fs.existsSync(migrationsDir)) {
      migrationsDir = path.join(__dirname, '../app/db/migrations');
    }
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        const [rows] = await connection.query('SELECT name FROM _migrations WHERE name = ?', [file]);
        if (rows.length === 0) {
          console.log(`Applying migration: ${file}...`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await connection.query(sql);
          await connection.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
          console.log(`✓ Applied ${file}`);
        } else {
          console.log(`- Skipping already applied migration: ${file}`);
        }
      }
    }

    // Check and apply seeds
    let seedDir = path.join(__dirname, 'db/seed');
    if (!fs.existsSync(seedDir)) {
      seedDir = path.join(__dirname, '../app/db/seed');
    }
    if (fs.existsSync(seedDir)) {
      // 1. NCS Seed (steps, modules, tasks)
      const [stepRows] = await connection.query("SHOW TABLES LIKE 'steps'");
      if (stepRows.length > 0) {
        const [countResult] = await connection.query('SELECT COUNT(*) as count FROM steps');
        const [modCountResult] = await connection.query('SELECT COUNT(*) as count FROM modules');
        if (countResult[0].count === 0 && modCountResult[0].count === 0) {
          console.log('Seeding NCS data (steps)...');
          let ncsSeed = fs.readFileSync(path.join(seedDir, 'ncs_k72s004_seed.sql'), 'utf8');
          // Use INSERT IGNORE to prevent duplicate key errors on already existing modules/tasks
          ncsSeed = ncsSeed.replace(/INSERT INTO/g, 'INSERT IGNORE INTO');
          await connection.query(ncsSeed);
          console.log('✓ NCS seed loaded');
        } else {
          console.log(`- NCS seed already loaded (${countResult[0].count} steps present)`);
        }
      }

      // 2. Holidays Seed
      const [holidayRows] = await connection.query("SHOW TABLES LIKE 'holidays'");
      if (holidayRows.length > 0) {
        const [countResult] = await connection.query('SELECT COUNT(*) as count FROM holidays');
        if (countResult[0].count === 0) {
          console.log('Seeding Sri Lanka holidays 2026...');
          let holidaySeed = fs.readFileSync(path.join(seedDir, 'holidays_lk_2026.sql'), 'utf8');
          holidaySeed = holidaySeed.replace(/INSERT INTO/g, 'INSERT IGNORE INTO');
          await connection.query(holidaySeed);
          console.log('✓ Holiday seed loaded');
        } else {
          console.log(`- Holiday seed already loaded (${countResult[0].count} holidays present)`);
        }
      }
    }

    // 3. Ensure Default Admin User exists
    const [userTableRows] = await connection.query("SHOW TABLES LIKE 'users'");
    if (userTableRows.length > 0) {
      const [userCount] = await connection.query('SELECT COUNT(*) as count FROM users');
      if (userCount[0].count === 0) {
        console.log('Seeding default administrator...');
        // Hash for password123: $2a$10$af3dDS0Q1dSibTtBaowgoOaBfFVDatnZEBvLJTS3n8p.j00Bf8Sk.
        await connection.query(`
          INSERT INTO users (id, name, email, password_hash)
          VALUES (1, 'K.A.R.Lakshan', 'ravindukandawela@gmail.com', '$2a$10$af3dDS0Q1dSibTtBaowgoOaBfFVDatnZEBvLJTS3n8p.j00Bf8Sk.')
        `);
        console.log('✓ Default administrator created (ravindukandawela@gmail.com / password123)');
      }
    }

    // 4. Ensure Default Settings exist
    const [settingsTableRows] = await connection.query("SHOW TABLES LIKE 'settings'");
    if (settingsTableRows.length > 0) {
      const [settingsCount] = await connection.query('SELECT COUNT(*) as count FROM settings');
      if (settingsCount[0].count === 0) {
        console.log('Seeding default settings...');
        const defaults = [
          ['teacher_name', 'K.A.R.Lakshan'],
          ['teacher_designation', 'ICT Instructor'],
          ['approver_name', 'යූ.එම්.ආර්. නිරෝෂා'],
          ['center_in_charge_name', 'යූ.එම්.ආර්. නිරෝෂා'],
          ['center_in_charge_title', 'මධ්‍යස්ථාන භාර නිලධාරී'],
          ['centre_name_si', 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස'],
          ['org_name_si', 'ජාතික තරුණ සේවා සභාව'],
          ['institute_name', 'Technical Training Centre – Akuressa'],
          ['course_title', 'Information & Communication Technology Technician (NVQ Level 4)'],
          ['target_hours_per_month', '120']
        ];
        for (const [k, v] of defaults) {
          await connection.query('INSERT IGNORE INTO settings (k, v) VALUES (?, ?)', [k, v]);
        }
        console.log('✓ Default settings loaded');
      }
    }

    console.log('All migrations and seeds successfully processed!');
  } finally {
    await connection.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

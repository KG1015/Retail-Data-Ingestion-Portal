const fs = require('fs');
const fastcsv = require('fast-csv');
const { pool } = require('../config/db');
const { MAX_ERRORS } = require('./base.service');

const CHUNK_SIZE = 5000;

// Email validation
const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
};

const processUsersFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const records = [];
    const errors = [];
    let successCount = 0;
    let errorCount = 0;
    let rowNum = 1;

    const stream = fs.createReadStream(filePath);
    const csvStream = fastcsv.parse({ headers: true, skipEmptyLines: true, trim: true });

    const flushBatch = async () => {
      if (records.length === 0) return;
      const batch = [...records];
      records.length = 0;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Extract supervisor usernames to resolve IDs
        const supervisorUsernames = [...new Set(batch.map(r => r.supervisor_username).filter(Boolean))];
        const supervisorMap = {};
        
        if (supervisorUsernames.length > 0) {
            const queryPlaceholders = supervisorUsernames.map((_, i) => `$${i + 1}`).join(',');
            const selectQuery = `SELECT id, username FROM users WHERE username IN (${queryPlaceholders})`;
            const { rows: existingRows } = await client.query(selectQuery, supervisorUsernames);
            existingRows.forEach(r => {
                supervisorMap[r.username] = r.id;
            });
        }

        // Prepare bulk insert
        const insertValues = [];
        let index = 1;
        const insertRows = [];

        for (const row of batch) {
          const uType = parseInt(row.user_type, 10);
          
          insertValues.push(
            row.username,
            row.first_name || '',
            row.last_name || '',
            row.email,
            [1, 2, 3, 7].includes(uType) ? uType : 1,
            row.phone_number || '',
            supervisorMap[row.supervisor_username] || null,
            (row.is_active && row.is_active.toLowerCase() === 'true')
          );

          insertRows.push(`($${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++})`);
        }

        if (insertRows.length > 0) {
          const insertQuery = `
            INSERT INTO users (
              username, first_name, last_name, email, user_type, phone_number, supervisor_id, is_active
            ) VALUES ${insertRows.join(', ')}
            ON CONFLICT (username) DO NOTHING
          `;
          const res = await client.query(insertQuery, insertValues);
          successCount += res.rowCount || 0;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error("Batch failure:", err.message);
        for (const row of batch) {
            if (errors.length < MAX_ERRORS) {
                errors.push({ row: row._originalRowNum, reason: 'Batch DB insert failed: ' + err.message });
            }
            errorCount++;
        }
      } finally {
        client.release();
      }
    };

    csvStream
      .on('data', async (row) => {
        rowNum++;
        let isValid = true;
        let failReason = '';

        if (!row.username || row.username.trim() === '') {
          isValid = false;
          failReason = 'Missing username';
        } else if (!row.email || !validateEmail(row.email)) {
          isValid = false;
          failReason = 'Invalid or missing email';
        } else if (row.user_type && ![1, 2, 3, 7].includes(parseInt(row.user_type, 10))) {
          isValid = false;
          failReason = 'Invalid user_type (must be 1, 2, 3, or 7)';
        }

        if (!isValid) {
          errorCount++;
          if (errors.length < MAX_ERRORS) {
            errors.push({ row: rowNum, data: row, reason: failReason });
          }
          return;
        }

        row._originalRowNum = rowNum;
        records.push(row);

        if (records.length >= CHUNK_SIZE) {
          csvStream.pause();
          await flushBatch();
          csvStream.resume();
        }
      })
      .on('end', async () => {
        if (records.length > 0) {
           await flushBatch();
        }
        resolve({
          successCount,
          errorCount,
          errors
        });
      })
      .on('error', (err) => {
        reject(err);
      });

    stream.pipe(csvStream);
  });
};

module.exports = { processUsersFile };

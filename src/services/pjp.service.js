const fs = require('fs');
const fastcsv = require('fast-csv');
const { pool } = require('../config/db');
const { MAX_ERRORS } = require('./base.service');

const CHUNK_SIZE = 5000;

const processPjpFile = (filePath) => {
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

        // Extract usernames and store_ids to resolve to actual DB IDs
        const usernames = [...new Set(batch.map(r => r.username).filter(Boolean))];
        const storeExtIds = [...new Set(batch.map(r => r.store_id).filter(Boolean))];
        
        const userMap = {};
        const storeMap = {};

        if (usernames.length > 0) {
            const queryPlaceholders = usernames.map((_, i) => `$${i + 1}`).join(',');
            const selectQuery = `SELECT id, username FROM users WHERE username IN (${queryPlaceholders})`;
            const { rows: userRows } = await client.query(selectQuery, usernames);
            userRows.forEach(r => userMap[r.username] = r.id);
        }

        if (storeExtIds.length > 0) {
            const queryPlaceholders = storeExtIds.map((_, i) => `$${i + 1}`).join(',');
            const selectQuery = `SELECT id, store_id FROM stores WHERE store_id IN (${queryPlaceholders})`;
            const { rows: storeRows } = await client.query(selectQuery, storeExtIds);
            storeRows.forEach(r => storeMap[r.store_id] = r.id);
        }

        // Prepare bulk insert and fail rows that don't pass the dependency validation
        const insertValues = [];
        let index = 1;
        const insertRows = [];

        for (const row of batch) {
          const uId = userMap[row.username];
          const sId = storeMap[row.store_id];

          if (!uId || !sId) {
             errorCount++;
             if (errors.length < MAX_ERRORS) {
                 errors.push({ 
                     row: row._originalRowNum, 
                     reason: `Dependency failed: ` + (!uId ? `username '${row.username}' not found. ` : '') + (!sId ? `store_id '${row.store_id}' not found.` : '')
                 });
             }
             continue; // Skip silently for DB, reported in errors array
          }

          let dateVal = null;
          if (row.date) {
             const parsed = new Date(row.date);
             if (!isNaN(parsed.getTime())) {
                 dateVal = row.date;
             } else {
                 errorCount++;
                 if (errors.length < MAX_ERRORS) {
                     errors.push({ row: row._originalRowNum, reason: `Invalid date format: ${row.date}` });
                 }
                 continue;
             }
          }

          insertValues.push(
            uId,
            sId,
            dateVal,
            (row.is_active && row.is_active.toLowerCase() === 'true')
          );

          insertRows.push(`($${index++}, $${index++}, $${index++}, $${index++})`);
        }

        if (insertRows.length > 0) {
          const insertQuery = `
            INSERT INTO permanent_journey_plans (
              user_id, store_id, date, is_active
            ) VALUES ${insertRows.join(', ')}
            ON CONFLICT (user_id, store_id, date) DO NOTHING
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
        } else if (!row.store_id || row.store_id.trim() === '') {
          isValid = false;
          failReason = 'Missing store_id';
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

module.exports = { processPjpFile };

const fs = require('fs');
const fastcsv = require('fast-csv');
const { pool } = require('../config/db');
const { normalizeStr, resolveLookups, MAX_ERRORS } = require('./base.service');

const CHUNK_SIZE = 5000;

const processStoresFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const records = [];
    const errors = [];
    let successCount = 0;
    let errorCount = 0;
    let rowNum = 1; // 1-based, 1 is usually header, so data is 2, but we track emitted row count
    
    let isProcessing = false;
    let streamPaused = false;

    const stream = fs.createReadStream(filePath);
    const csvStream = fastcsv.parse({ headers: true, skipEmptyLines: true, trim: true });

    const flushBatch = async () => {
      if (records.length === 0) return;
      const batch = [...records];
      records.length = 0; // Clear immediately

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Resolve lookups
        const brands = await resolveLookups(client, batch.map(r => r.store_brand), 'store_brands');
        const types = await resolveLookups(client, batch.map(r => r.store_type), 'store_types');
        const cities = await resolveLookups(client, batch.map(r => r.city), 'cities');
        const states = await resolveLookups(client, batch.map(r => r.state), 'states');
        const countries = await resolveLookups(client, batch.map(r => r.country), 'countries');
        const regions = await resolveLookups(client, batch.map(r => r.region), 'regions');

        // Prepare bulk insert for Stores
        const insertValues = [];
        let index = 1;
        const insertRows = [];

        for (const row of batch) {
          const lat = parseFloat(row.latitude);
          const lon = parseFloat(row.longitude);

          insertValues.push(
            row.store_id || '',
            row.store_external_id || '',
            row.name || '',
            row.title || '',
            brands[normalizeStr(row.store_brand)] || null,
            types[normalizeStr(row.store_type)] || null,
            cities[normalizeStr(row.city)] || null,
            states[normalizeStr(row.state)] || null,
            countries[normalizeStr(row.country)] || null,
            regions[normalizeStr(row.region)] || null,
            (!isNaN(lat) && lat >= -90 && lat <= 90) ? lat : 0,
            (!isNaN(lon) && lon >= -180 && lon <= 180) ? lon : 0
          );

          insertRows.push(`($${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++})`);
        }

        if (insertRows.length > 0) {
          const insertQuery = `
            INSERT INTO stores (
              store_id, store_external_id, name, title, 
              store_brand_id, store_type_id, city_id, state_id, country_id, region_id,
              latitude, longitude
            ) VALUES ${insertRows.join(', ')} 
            ON CONFLICT (store_id) DO NOTHING
          `;
          const res = await client.query(insertQuery, insertValues);
          successCount += res.rowCount || 0;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error("Batch failure:", err.message);
        // If an entire batch fails due to a DB issue, we mark them all as errors
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
        // Validation format constraints
        let isValid = true;
        let failReason = '';

        if (!row.store_id || row.store_id.trim() === '') {
          isValid = false;
          failReason = 'Missing store_id';
        } else if (!row.name || row.name.trim() === '') {
          isValid = false;
          failReason = 'Missing name';
        } else if (!row.title || row.title.trim() === '') {
          isValid = false;
          failReason = 'Missing title';
        } else if (row.name && row.name.length > 255) {
          isValid = false;
          failReason = 'name too long (max 255)';
        }

        if (isValid && row.latitude !== 'not_available') {
            const lat = parseFloat(row.latitude);
            if (isNaN(lat) || lat < -90 || lat > 90) {
               isValid = false;
               failReason = 'Invalid latitude';
            }
        }
        
        if (isValid && row.longitude !== 'not_available') {
            const lon = parseFloat(row.longitude);
            if (isNaN(lon) || lon < -180 || lon > 180) {
               isValid = false;
               failReason = 'Invalid longitude';
            }
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
          // Pause stream
          streamPaused = true;
          csvStream.pause();
          isProcessing = true;
          
          await flushBatch();
          
          isProcessing = false;
          streamPaused = false;
          csvStream.resume();
        }
      })
      .on('end', async () => {
        // flush remaining
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

module.exports = { processStoresFile };

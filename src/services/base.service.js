const fs = require('fs');
const fastcsv = require('fast-csv');
const { pool } = require('../config/db');

// Max errors to report
const MAX_ERRORS = 1000;

// Normalize string
const normalizeStr = (str) => {
  if (!str) return null;
  return String(str)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase(); // Lowercasing handles uniqueness safely
};

/**
 * Perform a batch get-or-create on a generic lookup table.
 * @param {Array<string>} rawValues - List of string values to resolve
 * @param {string} tableName - name of the table
 * @returns {Object} Map of normalized string to its ID.
 */
const resolveLookups = async (client, rawValues, tableName) => {
  const normalizedValues = [...new Set(rawValues.map(normalizeStr).filter(Boolean))];
  if (normalizedValues.length === 0) return {};

  const nameMap = {};

  // 1. Fetch existing
  const queryPlaceholders = normalizedValues.map((_, i) => `$${i + 1}`).join(',');
  const selectQuery = `SELECT id, name FROM ${tableName} WHERE name IN (${queryPlaceholders})`;
  const { rows: existingRows } = await client.query(selectQuery, normalizedValues);
  
  const existingNames = new Set();
  existingRows.forEach(r => {
    nameMap[r.name] = r.id;
    existingNames.add(r.name);
  });

  // 2. Discover missing
  const missingValues = normalizedValues.filter(val => !existingNames.has(val));
  
  if (missingValues.length > 0) {
    // 3. Bulk insert missing
    const insertValues = [];
    missingValues.forEach(val => insertValues.push(val));
    
    let insertQuery = `INSERT INTO ${tableName} (name) VALUES `;
    const insertPlaceholders = missingValues.map((_, i) => `($${i + 1})`).join(',');
    insertQuery += insertPlaceholders + ` ON CONFLICT (name) DO NOTHING RETURNING id, name`;
    
    // In rare cases (like parallel processing), ON CONFLICT might return nothing if another chunk inserted it,
    // so we re-select just to be absolutely safe, but RETURNING is faster for the ones we inserted.
    const { rows: newRows } = await client.query(insertQuery, insertValues);
    newRows.forEach(r => {
      nameMap[r.name] = r.id;
    });

    // For any that DO NOTHING shielded, we re-select
    if (newRows.length !== missingValues.length) {
      const { rows: doubleCheckRows } = await client.query(selectQuery, normalizedValues);
      doubleCheckRows.forEach(r => {
        nameMap[r.name] = r.id;
      });
    }
  }

  return nameMap;
};

module.exports = {
  MAX_ERRORS,
  normalizeStr,
  resolveLookups,
};

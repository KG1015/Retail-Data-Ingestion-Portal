const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  }
  : {
    user: process.env.PGUSER || 'user',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'infilectdb',
    password: process.env.PGPASSWORD || 'password',
    port: process.env.PGPORT || 5432,
    ssl: { rejectUnauthorized: false }
  };

const pool = new Pool(poolConfig);

const initializeSchema = async () => {
  const lookups = `
    CREATE TABLE IF NOT EXISTS store_brands (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS store_types (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS cities (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS states (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS countries (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS regions (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL);
  `;

  const stores = `
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      store_id VARCHAR(255) NOT NULL UNIQUE,
      store_external_id VARCHAR(255) DEFAULT '',
      name VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      store_brand_id INTEGER REFERENCES store_brands(id) ON DELETE SET NULL,
      store_type_id INTEGER REFERENCES store_types(id) ON DELETE SET NULL,
      city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
      state_id INTEGER REFERENCES states(id) ON DELETE SET NULL,
      country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL,
      region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
      latitude FLOAT DEFAULT 0.0,
      longitude FLOAT DEFAULT 0.0,
      is_active BOOLEAN DEFAULT TRUE,
      created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      modified_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const users = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(150) NOT NULL UNIQUE,
      first_name VARCHAR(150) DEFAULT '',
      last_name VARCHAR(150) DEFAULT '',
      email VARCHAR(254) NOT NULL,
      user_type INTEGER DEFAULT 1 CHECK (user_type IN (1, 2, 3, 7)),
      phone_number VARCHAR(32) DEFAULT '',
      supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      modified_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const pjp = `
    CREATE TABLE IF NOT EXISTS permanent_journey_plans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      date DATE,
      is_active BOOLEAN DEFAULT TRUE,
      created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      modified_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, store_id, date)
    );
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(lookups);
    await client.query(stores);
    await client.query(users);
    await client.query(pjp);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initializeSchema
};

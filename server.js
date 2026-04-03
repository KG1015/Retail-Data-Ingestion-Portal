const express = require('express');
const cors = require('cors');
const path = require('path');
const uploadRoutes = require('./src/routes/upload.routes');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/upload', uploadRoutes);

// Database initialization
const db = require('./src/config/db');

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}.`);
  try {
    await db.initializeSchema();
    console.log("Database schema initialized.");
  } catch (err) {
    console.error("Failed to initialize database schema:", err);
  }
});

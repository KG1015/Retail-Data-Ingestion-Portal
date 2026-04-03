const fs = require('fs');
const storeService = require('../services/store.service');
const userService = require('../services/user.service');
const pjpService = require('../services/pjp.service');

const cleanupFile = (path) => {
  if (path && fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
};

exports.uploadStores = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await storeService.processStoresFile(req.file.path);
    cleanupFile(req.file.path);
    res.json(result);
  } catch (error) {
    cleanupFile(req.file.path);
    res.status(500).json({ error: error.message });
  }
};

exports.uploadUsers = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await userService.processUsersFile(req.file.path);
    cleanupFile(req.file.path);
    res.json(result);
  } catch (error) {
    cleanupFile(req.file.path);
    res.status(500).json({ error: error.message });
  }
};

exports.uploadPjp = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await pjpService.processPjpFile(req.file.path);
    cleanupFile(req.file.path);
    res.json(result);
  } catch (error) {
    cleanupFile(req.file.path);
    res.status(500).json({ error: error.message });
  }
};

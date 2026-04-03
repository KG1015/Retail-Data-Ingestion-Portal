const express = require('express');
const multer = require('multer');
const { uploadStores, uploadUsers, uploadPjp } = require('../controllers/upload.controller');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // Temporary storage before processing

router.post('/stores', upload.single('file'), uploadStores);
router.post('/users', upload.single('file'), uploadUsers);
router.post('/pjp', upload.single('file'), uploadPjp);

module.exports = router;

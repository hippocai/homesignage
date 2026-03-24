const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { ensureRepoDir } = require('../config/fileRepo');
const { authenticateJWT } = require('../middleware/auth');
const ctrl = require('../controllers/fileRepoController');

// Multer: save to file-repo directory with sanitized original filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ensureRepoDir()),
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// GET  /api/v1/file-repo/:filename/stream  — no auth (display clients access via video.src)
router.get('/:filename/stream', ctrl.streamVideo);

// GET  /api/v1/file-repo              list files (?type=image|audio|video|other)
router.get('/', authenticateJWT, ctrl.list);

// POST /api/v1/file-repo              upload a file
router.post('/', authenticateJWT, upload.single('file'), ctrl.upload);

// GET  /api/v1/file-repo/:filename/download
router.get('/:filename/download', authenticateJWT, ctrl.download);

// PATCH /api/v1/file-repo/:filename   rename
router.patch('/:filename', authenticateJWT, ctrl.renameFile);

// DELETE /api/v1/file-repo/:filename
router.delete('/:filename', authenticateJWT, ctrl.deleteFile);

module.exports = router;

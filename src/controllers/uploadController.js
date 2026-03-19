const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../config/database');
const logger = require('../utils/logger');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueFilename = `${uuidv4()}${ext}`;
    cb(null, uniqueFilename);
  }
});

const ALLOWED_MIME_TYPES = {
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/aac': 'audio',
  'audio/mp4': 'audio',
  'video/mp4': 'video',
  'video/webm': 'video'
};

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

const uploadMiddleware = upload.single('file');

function saveUploadRecord(file, uploadedBy) {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const fileType = ALLOWED_MIME_TYPES[file.mimetype] || 'other';
    const url = `/uploads/${file.filename}`;

    db.run(
      `INSERT INTO uploads (id, filename, original_name, file_type, mime_type, size, url, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, file.filename, file.originalname, fileType, file.mimetype, file.size, url, uploadedBy],
      function (err) {
        if (err) return reject(err);
        db.get('SELECT * FROM uploads WHERE id = ?', [id], (err2, row) => {
          if (err2) return reject(err2);
          resolve(row);
        });
      }
    );
  });
}

async function uploadFile(req, res) {
  uploadMiddleware(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use "file" as the field name.' });
    }

    try {
      const uploadedBy = req.user ? req.user.id : null;
      const record = await saveUploadRecord(req.file, uploadedBy);
      logger.info('File uploaded', { filename: req.file.filename, size: req.file.size });
      return res.status(201).json({ data: record, message: 'File uploaded successfully' });
    } catch (dbErr) {
      logger.error('Save upload record error', { error: dbErr.message });
      // Try to clean up the uploaded file
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

async function listUploads(req, res) {
  return new Promise((resolve) => {
    const { type } = req.query;
    let query = 'SELECT * FROM uploads ORDER BY created_at DESC';
    const params = [];

    if (type) {
      query = 'SELECT * FROM uploads WHERE file_type = ? ORDER BY created_at DESC';
      params.push(type);
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        logger.error('List uploads error', { error: err.message });
        return res.status(500).json({ error: 'Internal server error' });
      }
      resolve(res.json({ data: rows }));
    });
  });
}

async function deleteUpload(req, res) {
  const { id } = req.params;

  return new Promise((resolve) => {
    db.get('SELECT * FROM uploads WHERE id = ?', [id], (err, row) => {
      if (err) {
        logger.error('Delete upload lookup error', { error: err.message });
        return resolve(res.status(500).json({ error: 'Internal server error' }));
      }

      if (!row) {
        return resolve(res.status(404).json({ error: 'Upload not found' }));
      }

      // Delete the file from disk
      const filePath = path.join(UPLOAD_DIR, row.filename);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
          logger.warn('Failed to delete upload file from disk', { filename: row.filename, error: unlinkErr.message });
        }

        // Delete the DB record regardless
        db.run('DELETE FROM uploads WHERE id = ?', [id], function (deleteErr) {
          if (deleteErr) {
            logger.error('Delete upload DB error', { error: deleteErr.message });
            return resolve(res.status(500).json({ error: 'Internal server error' }));
          }
          logger.info('Upload deleted', { uploadId: id, filename: row.filename });
          resolve(res.json({ message: 'Upload deleted successfully' }));
        });
      });
    });
  });
}

module.exports = { uploadFile, listUploads, deleteUpload };

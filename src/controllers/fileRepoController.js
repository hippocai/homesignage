const path = require('path');
const fs = require('fs');
const { getRepoPath, ensureRepoDir, getFileType } = require('../config/fileRepo');
const logger = require('../utils/logger');

const VIDEO_MIME = {
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.m4v':  'video/x-m4v',
  '.avi':  'video/x-msvideo',
  '.mkv':  'video/x-matroska',
  '.ogv':  'video/ogg',
};

function fileEntry(name, stat) {
  const type = getFileType(name);
  const encoded = encodeURIComponent(name);
  return {
    name,
    size: stat.size,
    type,
    url: `/file-repo/${encoded}`,
    streamUrl: type === 'video' ? `/api/v1/file-repo/${encoded}/stream` : undefined,
    mtime: stat.mtime.toISOString(),
  };
}

function sanitize(name) {
  return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

async function list(req, res) {
  const dir = ensureRepoDir();
  const { type } = req.query;
  try {
    let files = fs.readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        const full = path.join(dir, name);
        try {
          const stat = fs.statSync(full);
          if (!stat.isFile()) return null;
          return fileEntry(name, stat);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (type) files = files.filter((f) => f.type === type);
    files.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return res.json({ data: files });
  } catch (err) {
    logger.error('File repo list error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
}

async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: '未上传文件' });
  const name = req.file.filename;
  try {
    const stat = fs.statSync(req.file.path);
    logger.info('File uploaded to repo', { name, size: stat.size });
    return res.status(201).json({ data: fileEntry(name, stat), message: '文件上传成功' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function download(req, res) {
  const name = sanitize(decodeURIComponent(req.params.filename));
  const full = path.join(getRepoPath(), name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: '文件不存在' });
  res.download(full, name);
}

async function deleteFile(req, res) {
  const name = sanitize(decodeURIComponent(req.params.filename));
  const full = path.join(getRepoPath(), name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: '文件不存在' });
  try {
    fs.unlinkSync(full);
    logger.info('File deleted from repo', { name });
    return res.json({ message: '文件已删除' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function renameFile(req, res) {
  const oldName = sanitize(decodeURIComponent(req.params.filename));
  const newName = req.body.newName ? sanitize(req.body.newName) : '';
  if (!newName) return res.status(400).json({ error: 'newName is required' });

  const dir = getRepoPath();
  const oldPath = path.join(dir, oldName);
  const newPath = path.join(dir, newName);

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: '文件不存在' });
  if (fs.existsSync(newPath)) return res.status(409).json({ error: '目标文件名已存在' });

  try {
    fs.renameSync(oldPath, newPath);
    const stat = fs.statSync(newPath);
    logger.info('File renamed in repo', { oldName, newName });
    return res.json({ data: fileEntry(newName, stat), message: '文件已重命名' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Video streaming — no auth required (called directly by display clients via video.src)
// Handles HTTP Range requests so browsers can seek and start playback immediately.
function streamVideo(req, res) {
  const name = sanitize(decodeURIComponent(req.params.filename));
  const filePath = path.join(getRepoPath(), name);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });

  const ext = path.extname(name).toLowerCase();
  const contentType = VIDEO_MIME[ext];
  if (!contentType) return res.status(415).json({ error: '不支持的视频格式' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;

    if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
      return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    }

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': end - start + 1,
      'Content-Type':   contentType,
      'Cache-Control':  'no-store',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges':  'bytes',
      'Content-Type':   contentType,
      'Cache-Control':  'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

module.exports = { list, upload, download, deleteFile, renameFile, streamVideo };

const path = require('path');
const fs = require('fs');
const { getRepoPath, ensureRepoDir, getFileType } = require('../config/fileRepo');
const logger = require('../utils/logger');

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
          return {
            name,
            size: stat.size,
            type: getFileType(name),
            url: `/file-repo/${encodeURIComponent(name)}`,
            mtime: stat.mtime.toISOString(),
          };
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
    return res.status(201).json({
      data: {
        name,
        size: stat.size,
        type: getFileType(name),
        url: `/file-repo/${encodeURIComponent(name)}`,
        mtime: stat.mtime.toISOString(),
      },
      message: '文件上传成功',
    });
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
    return res.json({
      data: {
        name: newName,
        size: stat.size,
        type: getFileType(newName),
        url: `/file-repo/${encodeURIComponent(newName)}`,
        mtime: stat.mtime.toISOString(),
      },
      message: '文件已重命名',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { list, upload, download, deleteFile, renameFile };

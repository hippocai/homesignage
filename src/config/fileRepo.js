const path = require('path');
const fs = require('fs');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);

function getRepoPath() {
  const p = process.env.FILE_REPO_PATH || './file-repo';
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function ensureRepoDir() {
  const dir = getRepoPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'other';
}

module.exports = { getRepoPath, ensureRepoDir, getFileType };

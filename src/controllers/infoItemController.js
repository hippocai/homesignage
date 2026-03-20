const { v4: uuidv4 } = require('uuid');
const infoItemDao = require('../dao/infoItemDao');

async function list(req, res) {
  try {
    const items = await infoItemDao.findAll();
    res.json({ data: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listActive(req, res) {
  try {
    const items = await infoItemDao.findActive();
    res.json({ data: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function create(req, res) {
  try {
    const { type, text, start_time, end_time } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const validTypes = ['info', 'important', 'urgent'];
    const item = await infoItemDao.create({
      id: uuidv4(),
      type: validTypes.includes(type) ? type : 'info',
      text: text.trim(),
      start_time: start_time || null,
      end_time: end_time || null,
    });
    res.status(201).json({ data: item, message: '信息已创建' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const { type, text, start_time, end_time } = req.body;
    const validTypes = ['info', 'important', 'urgent'];
    const fields = {};
    if (type !== undefined && validTypes.includes(type)) fields.type = type;
    if (text !== undefined) fields.text = text.trim();
    if ('start_time' in req.body) fields.start_time = start_time || null;
    if ('end_time' in req.body) fields.end_time = end_time || null;
    const item = await infoItemDao.update(id, fields);
    if (!item) return res.status(404).json({ error: '信息不存在' });
    res.json({ data: item, message: '信息已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteItem(req, res) {
  try {
    const { id } = req.params;
    const deleted = await infoItemDao.delete(id);
    if (!deleted) return res.status(404).json({ error: '信息不存在' });
    res.json({ message: '信息已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { list, listActive, create, update, delete: deleteItem };

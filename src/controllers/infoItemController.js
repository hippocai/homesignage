const { v4: uuidv4 } = require('uuid');
const infoItemDao = require('../dao/infoItemDao');
const socketService = require('../services/socketService');

const briefing = require('../services/briefing/service');
async function checkAnnouncement(body, old = {}) {
  if (body.companion_targets !== undefined) await briefing.validTargets(body.companion_targets);
  const start = 'start_time' in body ? body.start_time : old.start_time;
  const end = 'end_time' in body ? body.end_time : old.end_time;
  if ((start && !Number.isFinite(Date.parse(start))) || (end && !Number.isFinite(Date.parse(end))) ||
      (start && end && Date.parse(end) <= Date.parse(start))) {
    throw Object.assign(new Error('结束时间必须晚于有效的开始时间'), {status:400});
  }
}
function notifyClients() {
  socketService.emitToAll('info-items-updated', {});
}

async function list(req, res) {
  try {
    const items = await infoItemDao.findAll();
    res.json({ data: items });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function listActive(req, res) {
  try {
    const items = await infoItemDao.findActive();
    res.json({ data: items });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function create(req, res) {
  try {
    const { type, text, start_time, end_time } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const validTypes = ['info', 'important', 'urgent'];
    await checkAnnouncement(req.body);
    const item = await infoItemDao.create({
      id: uuidv4(),
      companion_targets: req.body.companion_targets,
      type: validTypes.includes(type) ? type : 'info',
      text: text.trim(),
      start_time: start_time || null,
      end_time: end_time || null,
    });
    notifyClients();
    if (req.body.companion_targets?.length) {
      // Target preferences were committed in the same write as the item.
      await briefing.syncFamily(item.id);
    }
    res.status(201).json({ data: item, message: '信息已创建' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const { type, text, start_time, end_time } = req.body;
    const validTypes = ['info', 'important', 'urgent'];
    await checkAnnouncement(req.body, await infoItemDao.findById(id) || {});
    const fields = {companion_targets:req.body.companion_targets,replay:req.body.replay};
    if (type !== undefined && validTypes.includes(type)) fields.type = type;
    if (text !== undefined) fields.text = text.trim();
    if ('start_time' in req.body) fields.start_time = start_time || null;
    if ('end_time' in req.body) fields.end_time = end_time || null;
    const item = await infoItemDao.update(id, fields);
    if (!item) return res.status(404).json({ error: '信息不存在' });
    notifyClients();
    // Reconcile the committed revision now; the worker also recovers interrupted requests.
    await briefing.syncFamily(id);
    briefing.notify([]);
    res.json({ data: item, message: '信息已更新' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function deleteItem(req, res) {
  try {
    const { id } = req.params;
    const deleted = await infoItemDao.delete(id);
    if (!deleted) return res.status(404).json({ error: '信息不存在' });
    notifyClients();
    briefing.notify([]);
    res.json({ message: '信息已删除' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { list, listActive, create, update, delete: deleteItem };

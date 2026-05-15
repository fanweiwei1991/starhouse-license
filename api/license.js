import { put, list } from '@vercel/blob';

const ADMIN_KEY = 'starhouse_admin_2024';
const DATA_KEY = 'starhouse_licenses.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    switch (action) {
      case 'activate': return handleActivate(req, res);
      case 'verify': return handleVerify(req, res);
      case 'generate': return handleGenerate(req, res);
      case 'list': return handleList(req, res);
      case 'disable': return handleDisable(req, res);
      case 'enable': return handleEnable(req, res);
      case 'delete': return handleDelete(req, res);
      case 'stats': return handleStats(req, res);
      default:
        return res.status(400).json({ error: '未知操作' });
    }
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}

async function readData() {
  try {
    const { blobs } = await list({ prefix: DATA_KEY });
    if (blobs.length > 0) {
      const r = await fetch(blobs[0].url);
      return await r.json();
    }
  } catch (e) {}
  return { licenses: {} };
}

async function writeData(data) {
  await put(DATA_KEY, JSON.stringify(data), { access: 'public', addRandomSuffix: false });
}

async function handleActivate(req, res) {
  const { key, deviceId } = req.body;
  if (!key || !deviceId) return res.status(400).json({ error: '缺少参数' });
  const data = await readData();
  const license = data.licenses[key];
  if (!license) return res.status(404).json({ error: '密钥不存在' });
  if (!license.enabled) return res.status(403).json({ error: '密钥已被禁用' });
  if (license.expiry && new Date(license.expiry) < new Date()) return res.status(403).json({ error: '密钥已过期' });
  if (license.deviceId && license.deviceId !== deviceId) {
    return res.status(403).json({ error: '该密钥已在其他设备上激活' });
  }
  license.deviceId = deviceId;
  license.activatedAt = license.activatedAt || new Date().toISOString();
  license.lastVerify = new Date().toISOString();
  license.verifyCount = (license.verifyCount || 0) + 1;
  await writeData(data);
  return res.json({ success: true, message: '激活成功', expiry: license.expiry });
}

async function handleVerify(req, res) {
  const { key, deviceId } = req.body;
  if (!key || !deviceId) return res.status(400).json({ error: '缺少参数' });
  const data = await readData();
  const license = data.licenses[key];
  if (!license) return res.status(404).json({ error: '密钥无效' });
  if (!license.enabled) return res.status(403).json({ error: '密钥已被禁用' });
  if (license.expiry && new Date(license.expiry) < new Date()) return res.status(403).json({ error: '密钥已过期' });
  if (license.deviceId !== deviceId) return res.status(403).json({ error: '设备不匹配' });
  license.lastVerify = new Date().toISOString();
  license.verifyCount = (license.verifyCount || 0) + 1;
  await writeData(data);
  return res.json({ success: true, expiry: license.expiry });
}

async function handleGenerate(req, res) {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer ' + ADMIN_KEY) return res.status(401).json({ error: '管理员验证失败' });
  const { count = 1, days = 365, note = '' } = req.body;
  const expiry = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
  const data = await readData();
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = generateKey();
    data.licenses[key] = { key, enabled: true, expiry, deviceId: null, activatedAt: null, createdAt: new Date().toISOString(), lastVerify: null, verifyCount: 0, note };
    keys.push(key);
  }
  await writeData(data);
  return res.json({ success: true, keys, expiry });
}

async function handleList(req, res) {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer ' + ADMIN_KEY) return res.status(401).json({ error: '管理员验证失败' });
  const data = await readData();
  const licenses = Object.values(data.licenses).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json({ success: true, licenses });
}

async function handleDisable(req, res) {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer ' + ADMIN_KEY) return res.status(401).json({ error: '管理员验证失败' });
  const { key } = req.body;
  const data = await readData();
  if (!data.licenses[key]) return res.status(404).json({ error: '密钥不存在' });
  data.licenses[key].enabled = false;
  await writeData(data);
  return res.json({ success: true });
}

async function handleEnable(req, res) {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer ' + ADMIN_KEY) return res.status(401).json({ error: '管理员验证失败' });
  const { key } = req.body;
  const data = await readData();
  if (!data.licenses[key]) return res.status(404).json({ error: '密钥不存在' });
  data.licenses[key].enabled = true;
  data.licenses[key].deviceId = null;
  await writeData(data);
  return res.json({ success: true });
}

async function handleDelete(req, res) {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer ' + ADMIN_KEY) return res.status(401).json({ error: '管理员验证失败' });
  const { key } = req.body;
  const data = await readData();
  if (!data.licenses[key]) return res.status(404).json({ error: '密钥不存在' });
  delete data.licenses[key];
  await writeData(data);
  return res.json({ success: true });
}

async function handleStats(req, res) {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer ' + ADMIN_KEY) return res.status(401).json({ error: '管理员验证失败' });
  const data = await readData();
  const all = Object.values(data.licenses);
  return res.json({ success: true, stats: { total: all.length, active: all.filter(l => l.enabled && (!l.expiry || new Date(l.expiry) > new Date())).length, activated: all.filter(l => l.deviceId).length, disabled: all.filter(l => !l.enabled).length } });
}

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = 'STAR';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) key += '-';
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

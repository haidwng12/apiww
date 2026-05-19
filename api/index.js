import { createClient } from '@vercel/kv';

const kv = createClient({ url: process.env.KV_URL, token: process.env.KV_TOKEN });
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  // ======================= API =======================
  if (action === 'verify' && req.method === 'POST') {
    const { username, key } = req.body;
    if (!username || !key) return res.json({ ok: false, reason: 'Thiếu username/key' });
    const stored = await kv.get(`key:${username}`);
    if (!stored) return res.json({ ok: false, reason: 'Sai username' });
    const { key: storedKey, expiry } = JSON.parse(stored);
    if (storedKey !== key) return res.json({ ok: false, reason: 'Sai key' });
    if (expiry < Date.now()) return res.json({ ok: false, reason: 'Key hết hạn' });
    return res.json({ ok: true, expiry });
  }

  if (action === 'getTool' && req.method === 'GET') {
    const tool = await kv.get('tool');
    return res.json(tool ? JSON.parse(tool) : { version: '1.0.0', script: '' });
  }

  // Admin required
  const auth = req.headers.authorization?.split(' ')[1];
  if (auth !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

  if (action === 'list' && req.method === 'GET') {
    const keys = await kv.keys('key:*');
    const list = [];
    for (const k of keys) {
      const val = await kv.get(k);
      const username = k.replace('key:', '');
      list.push({ username, ...JSON.parse(val) });
    }
    return res.json(list);
  }

  if (action === 'create' && req.method === 'POST') {
    const { username, days = 30 } = req.body;
    if (!username) return res.status(400).json({ error: 'Thiếu username' });
    const key = Math.random().toString(36).substring(2, 10);
    const expiry = Date.now() + days * 86400000;
    await kv.set(`key:${username}`, JSON.stringify({ key, expiry, createdAt: Date.now() }));
    return res.json({ ok: true, username, key, expiry });
  }

  if (action === 'delete' && req.method === 'DELETE') {
    const { username } = req.body;
    await kv.del(`key:${username}`);
    return res.json({ ok: true });
  }

  if (action === 'updateTool' && req.method === 'POST') {
    const { version, script } = req.body;
    await kv.set('tool', JSON.stringify({ version, script, updatedAt: Date.now() }));
    return res.json({ ok: true });
  }

  // ======================= GIAO DIỆN ADMIN (HTML) =======================
  if (!action || action === 'admin') {
    res.setHeader('Content-Type', 'text/html');
    return res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OLM Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style> body { font-family: system-ui; } </style>
</head>
<body class="bg-gray-100">
  <div class="max-w-6xl mx-auto p-6">
    <div class="bg-white rounded-2xl shadow-xl p-6 mb-6">
      <h1 class="text-3xl font-bold text-gray-800">🔐 OLM Admin Panel</h1>
      <p class="text-gray-500">Quản lý key & tool</p>
    </div>
    <div class="bg-white rounded-2xl shadow-xl p-6">
      <div class="border-b mb-6">
        <button id="btn-keys" class="py-2 px-4 font-semibold text-blue-600 border-b-2 border-blue-600">🗝️ Keys</button>
        <button id="btn-tool" class="py-2 px-4 font-semibold text-gray-600">🛠️ Tool</button>
      </div>
      <div id="panel-keys">
        <div class="flex flex-wrap gap-4 mb-6">
          <input id="new-user" type="text" placeholder="Username" class="border p-2 rounded-lg flex-1">
          <input id="new-days" type="number" value="30" class="border p-2 rounded-lg w-32">
          <button id="create-key" class="bg-green-600 text-white px-4 py-2 rounded-lg">➕ Tạo key</button>
        </div>
        <div class="overflow-auto">
          <table class="min-w-full border">
            <thead class="bg-gray-100"><tr><th class="border p-2">Username</th><th class="border p-2">Key</th><th class="border p-2">Hết hạn</th><th class="border p-2"></th></tr></thead>
            <tbody id="key-list"></tbody>
          </table>
        </div>
      </div>
      <div id="panel-tool" class="hidden">
        <div class="mb-4 flex gap-4">
          <input id="tool-version" type="text" placeholder="Version" class="border p-2 rounded-lg w-40">
          <button id="save-tool" class="bg-blue-600 text-white px-4 py-2 rounded-lg">💾 Lưu tool</button>
        </div>
        <textarea id="tool-script" rows="16" class="w-full border rounded-lg p-3 font-mono text-sm"></textarea>
      </div>
    </div>
  </div>
  <script>
    const ADMIN_TOKEN = prompt("Admin token:") || "";
    const API_BASE = "/api/index";

    async function api(action, method, body=null) {
      const res = await fetch(\`\${API_BASE}?action=\${action}\`, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${ADMIN_TOKEN}\` },
        body: body ? JSON.stringify(body) : undefined
      });
      return res.json();
    }

    async function loadKeys() {
      const data = await api('list', 'GET');
      const tbody = document.getElementById('key-list');
      tbody.innerHTML = '';
      data.forEach(k => {
        const row = document.createElement('tr');
        row.innerHTML = \`
          <td class="border p-2 font-mono">\${escapeHtml(k.username)}</td>
          <td class="border p-2 font-mono">\${k.key}</td>
          <td class="border p-2">\${new Date(k.expiry).toLocaleString()}</td>
          <td class="border p-2"><button onclick="deleteKey('\${k.username}')" class="bg-red-500 text-white px-2 py-1 rounded text-sm">Xóa</button></td>
        \`;
        tbody.appendChild(row);
      });
    }

    window.deleteKey = async (username) => {
      if(confirm(\`Xóa key của \${username}?\`)) {
        await api('delete', 'DELETE', { username });
        loadKeys();
      }
    };

    document.getElementById('create-key').onclick = async () => {
      const username = document.getElementById('new-user').value.trim();
      const days = parseInt(document.getElementById('new-days').value);
      if(!username) return alert('Nhập username');
      const res = await api('create', 'POST', { username, days });
      if(res.ok) alert(\`✅ \${res.username} | Key: \${res.key}\`);
      else alert('Lỗi');
      loadKeys();
      document.getElementById('new-user').value = '';
    };

    async function loadTool() {
      const res = await fetch(\`\${API_BASE}?action=getTool\`);
      const data = await res.json();
      document.getElementById('tool-version').value = data.version || '';
      document.getElementById('tool-script').value = data.script || '';
    }

    document.getElementById('save-tool').onclick = async () => {
      const version = document.getElementById('tool-version').value;
      const script = document.getElementById('tool-script').value;
      const res = await api('updateTool', 'POST', { version, script });
      if(res.ok) alert('Đã lưu tool');
      else alert('Lỗi');
    };

    function escapeHtml(str) { return str.replace(/[&<>]/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[m];}); }

    const btnKeys = document.getElementById('btn-keys');
    const btnTool = document.getElementById('btn-tool');
    const panelKeys = document.getElementById('panel-keys');
    const panelTool = document.getElementById('panel-tool');

    btnKeys.onclick = () => {
      btnKeys.className = 'py-2 px-4 font-semibold text-blue-600 border-b-2 border-blue-600';
      btnTool.className = 'py-2 px-4 font-semibold text-gray-600';
      panelKeys.classList.remove('hidden');
      panelTool.classList.add('hidden');
      loadKeys();
    };
    btnTool.onclick = () => {
      btnTool.className = 'py-2 px-4 font-semibold text-blue-600 border-b-2 border-blue-600';
      btnKeys.className = 'py-2 px-4 font-semibold text-gray-600';
      panelTool.classList.remove('hidden');
      panelKeys.classList.add('hidden');
      loadTool();
    };
    loadKeys();
  </script>
</body>
</html>`);
  }

  return res.status(404).json({ error: 'Not found' });
}

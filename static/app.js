/* ── State ── */
const state = {
  modules: [],
  total: 0,
  prototypes: [],
  currentModuleId: null,
  searchQuery: '',
  currentPrototype: null,
};

/* ── Utils ── */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return (bytes / Math.pow(1024, i)).toFixed(1).replace(/\.0$/, '') + ' ' + units[i];
}

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function overlayClose(e, id) { if (e.target === e.currentTarget) closeModal(id); }

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  loading ? btn.classList.add('btn-loading') : btn.classList.remove('btn-loading');
}

/* ── API ── */
const api = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || '请求失败'); }
    return res.json();
  },
  async post(url, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method: 'POST',
      headers: isForm ? {} : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || '请求失败');
    return j;
  },
  async put(url, body) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || '请求失败');
    return j;
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || '请求失败'); }
    return res.json();
  },
};

/* ── Data loading ── */
async function loadModules() {
  const data = await api.get('/api/modules');
  state.modules = data.modules;
  state.total = data.total;
  renderSidebar();
}

async function loadPrototypes() {
  const url = state.currentModuleId
    ? `/api/prototypes?module_id=${state.currentModuleId}`
    : '/api/prototypes';
  state.prototypes = await api.get(url);
  renderPrototypes();
}

/* ── Render: Sidebar ── */
function renderSidebar() {
  const allActive = state.currentModuleId === null ? 'active' : '';
  let html = `
    <div class="module-item ${allActive}" onclick="selectModule(null)">
      <span class="module-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
      </span>
      <span class="module-name">全部原型</span>
      <span class="module-count">${state.total}</span>
    </div>`;

  for (const m of state.modules) {
    const active = state.currentModuleId === m.id ? 'active' : '';
    html += `
      <div class="module-item ${active}" onclick="selectModule(${m.id})">
        <span class="module-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <span class="module-name">${esc(m.name)}</span>
        <span class="module-count">${m.prototype_count}</span>
        <div class="module-actions">
          <button class="btn-icon" title="编辑" onclick="event.stopPropagation();openEditModuleModal(${m.id},'${esc(m.name)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon del" title="删除" onclick="event.stopPropagation();confirmDeleteModule(${m.id},'${esc(m.name)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }

  document.getElementById('module-list').innerHTML = html;

  const current = state.currentModuleId === null
    ? '全部原型'
    : (state.modules.find(m => m.id === state.currentModuleId)?.name ?? '');
  document.getElementById('page-title').textContent = current;
}

/* ── Render: Prototype Grid ── */
function renderPrototypes() {
  const grid = document.getElementById('prototype-grid');
  const empty = document.getElementById('empty-state');

  let list = state.prototypes;
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }

  if (list.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  grid.innerHTML = list.map(p => `
    <div class="proto-card" onclick="openDetailModal(${p.id})">
      <div class="proto-card-header">
        <span class="proto-card-title">${esc(p.name)}</span>
        <span class="proto-card-tag">${esc(p.module_name)}</span>
      </div>
      ${p.description ? `<div style="font-size:12px;color:#999;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.description)}</div>` : ''}
      <div class="proto-card-footer">
        <span class="proto-card-time">更新：${p.updated_at}</span>
        <a class="proto-card-preview" href="/preview/${p.preview_id}" target="_blank"
           onclick="event.stopPropagation()">预览 ↗</a>
      </div>
    </div>`).join('');
}

/* ── Module: select ── */
function selectModule(id) {
  state.currentModuleId = id;
  renderSidebar();
  loadPrototypes();
}

/* ── Module: add ── */
function openAddModuleModal() {
  document.getElementById('add-module-name').value = '';
  openModal('modal-add-module');
  setTimeout(() => document.getElementById('add-module-name').focus(), 80);
}

async function submitAddModule() {
  const name = document.getElementById('add-module-name').value.trim();
  if (!name) { showToast('请输入模块名称', 'error'); return; }
  try {
    await api.post('/api/modules', { name });
    closeModal('modal-add-module');
    showToast('模块创建成功', 'success');
    await loadModules();
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Module: edit ── */
function openEditModuleModal(id, name) {
  document.getElementById('edit-module-id').value = id;
  document.getElementById('edit-module-name').value = name;
  openModal('modal-edit-module');
  setTimeout(() => document.getElementById('edit-module-name').focus(), 80);
}

async function submitEditModule() {
  const id   = document.getElementById('edit-module-id').value;
  const name = document.getElementById('edit-module-name').value.trim();
  if (!name) { showToast('请输入模块名称', 'error'); return; }
  try {
    await api.put(`/api/modules/${id}`, { name });
    closeModal('modal-edit-module');
    showToast('模块更新成功', 'success');
    await loadModules();
    await loadPrototypes();
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Module: delete ── */
async function confirmDeleteModule(id, name) {
  if (!confirm(`确认删除模块「${name}」？\n该模块下的所有原型也将被删除，此操作不可恢复。`)) return;
  try {
    await api.del(`/api/modules/${id}`);
    if (state.currentModuleId === id) state.currentModuleId = null;
    showToast('模块已删除', 'success');
    await loadModules();
    await loadPrototypes();
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Prototype: new ── */
function openNewPrototypeModal() {
  const sel = document.getElementById('new-proto-module');
  sel.innerHTML = '<option value="">请选择模块</option>' +
    state.modules.map(m =>
      `<option value="${m.id}" ${m.id === state.currentModuleId ? 'selected' : ''}>${esc(m.name)}</option>`
    ).join('');
  document.getElementById('new-proto-name').value = '';
  document.getElementById('new-proto-desc').value = '';
  document.getElementById('new-proto-file').value = '';
  document.getElementById('new-upload-selected').textContent = '';
  openModal('modal-new-prototype');
}

function onFileSelect(input, selectedId) {
  const file = input.files[0];
  if (file) document.getElementById(selectedId).textContent = `已选择：${file.name}`;
}

async function submitNewPrototype() {
  const module_id   = document.getElementById('new-proto-module').value;
  const name        = document.getElementById('new-proto-name').value.trim();
  const description = document.getElementById('new-proto-desc').value.trim();
  const fileInput   = document.getElementById('new-proto-file');

  if (!module_id)       { showToast('请选择模块', 'error'); return; }
  if (!name)            { showToast('请输入原型名称', 'error'); return; }
  if (!fileInput.files[0]) { showToast('请上传原型文件', 'error'); return; }

  const fd = new FormData();
  fd.append('module_id',   module_id);
  fd.append('name',        name);
  fd.append('description', description);
  fd.append('file',        fileInput.files[0]);

  setLoading('btn-create-proto', true);
  try {
    await api.post('/api/prototypes', fd);
    closeModal('modal-new-prototype');
    showToast('原型创建成功', 'success');
    await loadModules();
    await loadPrototypes();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setLoading('btn-create-proto', false);
  }
}

/* ── Prototype: detail ── */
async function openDetailModal(id) {
  try {
    const p = await api.get(`/api/prototypes/${id}`);
    state.currentPrototype = p;

    document.getElementById('detail-title').textContent = p.name;

    const previewUrl = `${location.origin}/preview/${p.preview_id}`;

    const recordsHtml = (p.records || []).length
      ? (p.records || []).map(r => `
          <div class="record-item">
            <span class="record-time">${r.upload_time}${r.uploader ? '  ' + esc(r.uploader) : ''}</span>
            <span class="record-count">${r.update_notes ? esc(r.update_notes) : '1 个文件'}</span>
            <span class="record-size">${fmtSize(r.file_size)}</span>
          </div>`).join('')
      : '<div class="record-empty">暂无上传记录</div>';

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-info">
        <div class="detail-row">
          <span class="detail-label">预览链接</span>
          <span class="detail-value">
            <a href="${previewUrl}" target="_blank" class="preview-link">${previewUrl}</a>
            <button class="copy-btn" onclick="copyText('${previewUrl}')">复制</button>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">所属模块</span>
          <span class="detail-value"><span class="module-tag">${esc(p.module_name)}</span></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">更新时间</span>
          <span class="detail-value">${p.updated_at}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">创建时间</span>
          <span class="detail-value">${p.created_at}</span>
        </div>
      </div>

      <div class="detail-actions">
        <button class="btn-secondary" onclick="openEditProtoModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg> 编辑
        </button>
        <a class="btn-secondary" href="/preview/${p.preview_id}" target="_blank">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg> 打开预览
        </a>
        <a class="btn-secondary" href="/api/prototypes/${p.id}/download">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg> 下载源文件
        </a>
        <button class="btn-secondary" onclick="openUpdateFileModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
          </svg> 更新文件
        </button>
        <button class="btn-danger" onclick="confirmDeleteProto(${p.id})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg> 删除
        </button>
      </div>

      <div class="upload-records-title">上传记录</div>
      <div class="record-list">${recordsHtml}</div>`;

    openModal('modal-detail');
  } catch (e) {
    showToast('加载失败：' + e.message, 'error');
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('链接已复制', 'success'))
    .catch(() => showToast('复制失败，请手动复制', 'error'));
}

/* ── Prototype: edit ── */
function openEditProtoModal() {
  const p = state.currentPrototype;
  if (!p) return;
  document.getElementById('edit-proto-id').value = p.id;
  document.getElementById('edit-proto-name').value = p.name;
  document.getElementById('edit-proto-desc').value = p.description || '';
  const sel = document.getElementById('edit-proto-module');
  sel.innerHTML = state.modules.map(m =>
    `<option value="${m.id}" ${m.id === p.module_id ? 'selected' : ''}>${esc(m.name)}</option>`
  ).join('');
  closeModal('modal-detail');
  openModal('modal-edit-proto');
}

async function submitEditPrototype() {
  const id          = document.getElementById('edit-proto-id').value;
  const name        = document.getElementById('edit-proto-name').value.trim();
  const module_id   = parseInt(document.getElementById('edit-proto-module').value);
  const description = document.getElementById('edit-proto-desc').value.trim();
  if (!name) { showToast('请输入原型名称', 'error'); return; }
  try {
    await api.put(`/api/prototypes/${id}`, { name, module_id, description });
    closeModal('modal-edit-proto');
    showToast('更新成功', 'success');
    await loadModules();
    await loadPrototypes();
    openDetailModal(id);
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Prototype: update file ── */
function openUpdateFileModal() {
  const p = state.currentPrototype;
  if (!p) return;
  document.getElementById('update-proto-id').value = p.id;
  document.getElementById('update-file-input').value = '';
  document.getElementById('update-upload-selected').textContent = '';
  document.getElementById('update-notes').value = '';
  document.getElementById('update-uploader').value = '';
  closeModal('modal-detail');
  openModal('modal-update-file');
}

async function submitUpdateFile() {
  const id        = document.getElementById('update-proto-id').value;
  const fileInput = document.getElementById('update-file-input');
  if (!fileInput.files[0]) { showToast('请选择文件', 'error'); return; }

  const fd = new FormData();
  fd.append('file',         fileInput.files[0]);
  fd.append('update_notes', document.getElementById('update-notes').value.trim());
  fd.append('uploader',     document.getElementById('update-uploader').value.trim());

  setLoading('btn-update-file', true);
  try {
    await api.post(`/api/prototypes/${id}/upload`, fd);
    closeModal('modal-update-file');
    showToast('文件更新成功', 'success');
    await loadPrototypes();
    openDetailModal(id);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setLoading('btn-update-file', false);
  }
}

/* ── Prototype: delete ── */
async function confirmDeleteProto(id) {
  if (!confirm('确认删除此原型？该操作不可恢复。')) return;
  try {
    await api.del(`/api/prototypes/${id}`);
    closeModal('modal-detail');
    state.currentPrototype = null;
    showToast('原型已删除', 'success');
    await loadModules();
    await loadPrototypes();
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Search ── */
function handleSearch(q) {
  state.searchQuery = q;
  renderPrototypes();
}

/* ── Drag & Drop for upload areas ── */
function setupDragDrop(areaId, inputId, selectedId) {
  const area = document.getElementById(areaId);
  if (!area) return;
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const input = document.getElementById(inputId);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    document.getElementById(selectedId).textContent = `已选择：${file.name}`;
  });
}

/* ── Init ── */
async function init() {
  setupDragDrop('new-upload-area',    'new-proto-file',    'new-upload-selected');
  setupDragDrop('update-upload-area', 'update-file-input', 'update-upload-selected');
  try {
    await loadModules();
    await loadPrototypes();
  } catch (e) {
    showToast('数据加载失败，请刷新页面', 'error');
  }
}

init();

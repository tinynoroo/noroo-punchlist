(function () {
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('count');
  const dotEl = document.getElementById('connDot');
  const rowTpl = document.getElementById('rowTemplate');
  const logoutBtn = document.getElementById('logoutBtn');

  const CAMERA_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.4A2 2 0 0 1 10.3 4.6h3.4a2 2 0 0 1 1.7 1L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.4"/></svg>';

  const timeFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  let defects = [];

  function render() {
    const sorted = defects.filter((d) => !d.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
    countEl.textContent = `${sorted.length}건`;
    emptyEl.hidden = sorted.length > 0;
    listEl.innerHTML = '';
    for (const d of sorted) {
      const node = rowTpl.content.cloneNode(true);
      const a = node.querySelector('.row');
      const thumb = node.querySelector('.thumb');
      const img = node.querySelector('.thumb img');
      const badge = node.querySelector('.more-badge');

      a.href = `/edit?id=${encodeURIComponent(d.id)}`;

      if (d.images && d.images.length > 0) {
        img.src = `/uploads/${d.id}/${d.images[0]}`;
        img.alt = d.location;
        if (d.images.length > 1) {
          badge.hidden = false;
          badge.textContent = `+${d.images.length - 1}`;
        }
      } else {
        img.remove();
        thumb.insertAdjacentHTML('afterbegin', CAMERA_ICON);
      }

      node.querySelector('.row-location').textContent = d.location;
      node.querySelector('.row-content').textContent = d.content;
      node.querySelector('.row-time').textContent = `${timeFmt.format(new Date(d.updatedAt))} 수정`;

      listEl.appendChild(node);
    }
  }

  function upsert(defect) {
    const idx = defects.findIndex((d) => d.id === defect.id);
    if (idx >= 0) defects[idx] = defect;
    else defects.push(defect);
    render();
  }

  fetch('/api/defects')
    .then((res) => res.json())
    .then((data) => { defects = data; render(); })
    .catch(() => { emptyEl.hidden = false; emptyEl.textContent = '목록을 불러오지 못했습니다. 새로고침해 주세요.'; });

  // ---------- 실시간 연결 ----------
  let backoff = 1000;
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener('open', () => {
      dotEl.classList.add('live');
      dotEl.classList.remove('down');
      backoff = 1000;
    });
    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'upsert' && msg.defect) upsert(msg.defect);
      } catch (e) { /* ignore */ }
    });
    ws.addEventListener('close', scheduleReconnect);
    ws.addEventListener('error', () => ws.close());
  }
  function scheduleReconnect() {
    dotEl.classList.remove('live');
    dotEl.classList.add('down');
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15000);
  }
  connect();

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  });
})();

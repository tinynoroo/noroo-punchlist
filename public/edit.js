(function () {
  const MAX_IMAGES = 5;
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const isEdit = Boolean(id);

  const form = document.getElementById('defectForm');
  const locationInput = document.getElementById('location');
  const contentInput = document.getElementById('content');
  const photoGrid = document.getElementById('photoGrid');
  const photoCountEl = document.getElementById('photoCount');
  const fileInput = document.getElementById('fileInput');
  const errorEl = document.getElementById('error');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = document.getElementById('submitLabel');
  const spinnerEl = submitBtn.querySelector('.spinner');
  const tileTpl = document.getElementById('photoTileTemplate');
  const deleteBtn = document.getElementById('deleteBtn');

  const idleLabel = isEdit ? '수정하기' : '등록하기';
  const busyLabel = isEdit ? '수정하는 중...' : '업로드하는 중...';
  document.getElementById('pageTitle').textContent = isEdit ? '하자 수정' : '하자 등록';
  submitLabel.textContent = idleLabel;

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    spinnerEl.hidden = !isSubmitting;
    submitLabel.textContent = isSubmitting ? busyLabel : idleLabel;
  }

  if (isEdit) {
    deleteBtn.hidden = false;
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('정말 삭제할까요? 삭제하면 목록에서 사라집니다.')) return;
      clearError();
      deleteBtn.disabled = true;
      deleteBtn.textContent = '삭제하는 중...';
      try {
        const res = await fetch(`/api/defects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('failed');
        location.href = '/';
      } catch (err) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = '삭제';
        showError('삭제하지 못했습니다.');
      }
    });
  }

  let existing = []; // { filename, url }
  let newFiles = []; // File

  function totalCount() { return existing.length + newFiles.length; }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function clearError() { errorEl.hidden = true; }

  function renderGrid() {
    photoGrid.innerHTML = '';
    photoCountEl.textContent = String(totalCount());

    existing.forEach((item, idx) => {
      const node = tileTpl.content.cloneNode(true);
      node.querySelector('img').src = item.url;
      node.querySelector('.remove-btn').addEventListener('click', () => {
        existing.splice(idx, 1);
        renderGrid();
      });
      photoGrid.appendChild(node);
    });

    newFiles.forEach((file, idx) => {
      const node = tileTpl.content.cloneNode(true);
      node.querySelector('img').src = URL.createObjectURL(file);
      node.querySelector('.remove-btn').addEventListener('click', () => {
        newFiles.splice(idx, 1);
        renderGrid();
      });
      photoGrid.appendChild(node);
    });

    if (totalCount() < MAX_IMAGES) {
      const addTile = document.createElement('div');
      addTile.className = 'add-tile';
      addTile.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
      addTile.addEventListener('click', () => fileInput.click());
      photoGrid.appendChild(addTile);
    }
  }

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    const room = MAX_IMAGES - totalCount();
    if (files.length > room) {
      showError(`사진은 최대 ${MAX_IMAGES}장까지 등록할 수 있습니다.`);
    } else {
      clearError();
    }
    newFiles = newFiles.concat(files.slice(0, room));
    fileInput.value = '';
    renderGrid();
  });

  if (isEdit) {
    fetch(`/api/defects/${encodeURIComponent(id)}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((d) => {
        locationInput.value = d.location;
        contentInput.value = d.content;
        existing = (d.images || []).map((filename) => ({
          filename,
          url: `/uploads/${d.id}/${filename}`,
        }));
        renderGrid();
      })
      .catch(() => {
        showError('하자 정보를 불러오지 못했습니다.');
      });
  } else {
    renderGrid();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);

    const formData = new FormData();
    formData.append('location', locationInput.value.trim());
    formData.append('content', contentInput.value.trim());
    if (isEdit) {
      formData.append('keepImages', JSON.stringify(existing.map((it) => it.filename)));
    }
    newFiles.forEach((file) => formData.append('images', file));

    try {
      const res = await fetch(isEdit ? `/api/defects/${encodeURIComponent(id)}` : '/api/defects', {
        method: isEdit ? 'PUT' : 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.error || '저장하지 못했습니다.');
        setSubmitting(false);
        return;
      }
      location.href = '/';
    } catch (err) {
      showError('네트워크 오류가 발생했습니다.');
      setSubmitting(false);
    }
  });
})();

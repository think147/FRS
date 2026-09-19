document.addEventListener('DOMContentLoaded', ()=>{
  const loginForm = document.getElementById('loginForm');
  const loginCard = document.getElementById('loginCard');
  const logoutBtn = document.getElementById('logoutBtn');
  const uploadCard = document.getElementById('uploadCard');
  const uploadForm = document.getElementById('uploadForm');
  const qrContainer = document.getElementById('qrContainer');
  const usersList = document.getElementById('usersList');
  const selectAllUsersCb = document.getElementById('selectAllUsersCb');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const userCountBadge = document.getElementById('userCountBadge');
  const selectedCount = document.getElementById('selectedCount');
  const selectedUserIds = new Set();

  // On load, check session and load users if already logged in
  (async function init(){
    try{
      const s = await fetch('/api/admin/session');
      const j = await s.json();
      if (j.isAdmin) { 
        if(loginCard) loginCard.style.display='none'; 
        uploadCard.style.display='block'; 
        if(logoutBtn) logoutBtn.style.display='block'; 
        loadUsers(); 
      }
      // set default report date to today
      const rd = document.getElementById('reportDate');
      if (rd) rd.value = new Date().toISOString().slice(0,10);
    }catch(e){ /* ignore */ }
  })();

  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(loginForm);
    const body = { username: fd.get('username'), password: fd.get('password') };
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { 
      if(loginCard) loginCard.style.display='none'; 
      uploadCard.style.display='block'; 
      if(logoutBtn) logoutBtn.style.display='block'; 
      loadUsers(); 
    }
    else { alert('Login failed'); }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST' });
      if(loginCard) loginCard.style.display='block'; 
      uploadCard.style.display='none'; 
      logoutBtn.style.display='none';
    });
  }

  const designationInput = document.getElementById('designationInput');
  const sectionInput = document.getElementById('sectionInput');
  let sectionManuallyEdited = false;
  if (sectionInput) {
    sectionInput.addEventListener('input', () => {
      sectionManuallyEdited = sectionInput.value.trim().length > 0;
    });
  }
  if (designationInput && sectionInput) {
    designationInput.addEventListener('input', () => {
      if (!sectionManuallyEdited || !sectionInput.value.trim()) {
        sectionInput.value = designationInput.value;
      }
    });
  }


  const faceFileInput = document.getElementById('faceFileInput');
  const openCameraBtn = document.getElementById('openCameraBtn');
  const captureCount = document.getElementById('captureCount');
  const capturePreview = document.getElementById('capturePreview');
  const cameraCapture = document.getElementById('cameraCapture');
  const cameraVideo = document.getElementById('cameraVideo');
  const takePhotoBtn = document.getElementById('takePhotoBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');

  let cameraStream = null;
  const capturedFaces = [];

  function updateCaptureUI(){
    if (captureCount) captureCount.innerText = `${capturedFaces.length} / 4 captured`;
    if (capturePreview) {
      capturePreview.innerHTML = capturedFaces.map((face, index) => {
        return `<div class="capture-thumb"><img src="${face.preview}" alt="Capture ${index+1}"><button type="button" data-index="${index}" class="remove-capture">Remove</button></div>`;
      }).join('');
    }
  }

  async function startCamera(){
    try{
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (cameraVideo) cameraVideo.srcObject = cameraStream;
      if (cameraCapture) cameraCapture.style.display = 'block';
      if (openCameraBtn) openCameraBtn.disabled = true;
    }catch(err){
      alert('Camera access failed: ' + (err.message || err));
    }
  }

  function stopCamera(){
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
    if (cameraCapture) cameraCapture.style.display = 'none';
    if (openCameraBtn) openCameraBtn.disabled = false;
  }

  function capturePhoto(){
    if (!cameraVideo || capturedFaces.length >= 4) return;
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth || 640;
    canvas.height = cameraVideo.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return;
      const previewUrl = URL.createObjectURL(blob);
      capturedFaces.push({ blob, preview: previewUrl });
      updateCaptureUI();
    }, 'image/jpeg', 0.9);
  }

  capturePreview?.addEventListener('click', (event) => {
    const target = event.target;
    if (target && target.matches('.remove-capture')) {
      const index = Number(target.getAttribute('data-index'));
      if (!Number.isNaN(index) && capturedFaces[index]) {
        URL.revokeObjectURL(capturedFaces[index].preview);
        capturedFaces.splice(index, 1);
        updateCaptureUI();
      }
    }
  });

  openCameraBtn?.addEventListener('click', startCamera);
  closeCameraBtn?.addEventListener('click', stopCamera);
  takePhotoBtn?.addEventListener('click', capturePhoto);

  uploadForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const files = faceFileInput ? Array.from(faceFileInput.files) : [];
    const totalFaces = files.length + capturedFaces.length;
    if (totalFaces < 4) {
      return alert('Please provide 4 face images either by file upload or camera capture.');
    }
    const fd = new FormData();
    new FormData(uploadForm).forEach((value, key) => {
      if (key !== 'faces') fd.append(key, value);
    });
    files.forEach(file => fd.append('faces', file));
    capturedFaces.forEach((face, index) => fd.append('faces', face.blob, `capture-${index+1}.jpg`));
    const r = await fetch('/api/users', { method: 'POST', body: fd });
    if (!r.ok) { const err = await r.json(); return alert('Error: '+(err.error||r.status)); }
    const user = await r.json();
    // Fetch QR
    const qr = await fetch('/api/users/' + user.id + '/qr');
    if (qr.ok) {
      const obj = await qr.json();
      qrContainer.innerHTML = `<h3>QR for ${user.name}</h3><img class="qr" src="${obj.dataUrl}"><p>URL: ${obj.url}</p>`;
    } else {
      qrContainer.innerText = 'QR generation failed';
    }
    faceFileInput.value = '';
    uploadForm.reset();
    capturedFaces.forEach(face => URL.revokeObjectURL(face.preview));
    capturedFaces.length = 0;
    updateCaptureUI();
    stopCamera();
    loadUsers();
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateSelectionState() {
    const allCbs = usersList.querySelectorAll('.user-card-cb');
    const total = allCbs.length;
    const count = selectedUserIds.size;

    if (userCountBadge) userCountBadge.innerText = total;
    if (selectedCount) selectedCount.innerText = count;

    if (deleteSelectedBtn) {
      if (count > 0) {
        deleteSelectedBtn.style.display = 'inline-flex';
        deleteSelectedBtn.disabled = false;
      } else {
        deleteSelectedBtn.style.display = 'none';
        deleteSelectedBtn.disabled = true;
      }
    }

    if (selectAllUsersCb) {
      if (total === 0) {
        selectAllUsersCb.checked = false;
        selectAllUsersCb.indeterminate = false;
      } else if (count === total) {
        selectAllUsersCb.checked = true;
        selectAllUsersCb.indeterminate = false;
      } else if (count > 0) {
        selectAllUsersCb.checked = false;
        selectAllUsersCb.indeterminate = true;
      } else {
        selectAllUsersCb.checked = false;
        selectAllUsersCb.indeterminate = false;
      }
    }
  }

  if (selectAllUsersCb) {
    selectAllUsersCb.addEventListener('change', () => {
      const allCbs = usersList.querySelectorAll('.user-card-cb');
      const shouldCheck = selectAllUsersCb.checked;
      allCbs.forEach(cb => {
        cb.checked = shouldCheck;
        const id = cb.getAttribute('data-id');
        const card = cb.closest('.user-card');
        if (shouldCheck) {
          selectedUserIds.add(id);
          if (card) card.classList.add('selected');
        } else {
          selectedUserIds.delete(id);
          if (card) card.classList.remove('selected');
        }
      });
      updateSelectionState();
    });
  }

  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedUserIds);
      if (!ids.length) return;
      if (!confirm(`Are you sure you want to delete ${ids.length} selected user(s)?\nThis will remove their profiles, uploaded images, and attendance records.`)) {
        return;
      }
      deleteSelectedBtn.disabled = true;
      deleteSelectedBtn.innerText = 'Deleting...';
      try {
        const res = await fetch('/api/users/delete-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) {
          const err = await res.json();
          alert('Failed to delete users: ' + (err.error || res.statusText));
          deleteSelectedBtn.disabled = false;
          updateSelectionState();
          return;
        }
        selectedUserIds.clear();
        await loadUsers();
      } catch (err) {
        alert('Error deleting users: ' + err.message);
        deleteSelectedBtn.disabled = false;
        updateSelectionState();
      }
    });
  }

  if (usersList) {
    // Checkbox toggle delegation
    usersList.addEventListener('change', (e) => {
      if (e.target.matches('.user-card-cb')) {
        const cb = e.target;
        const id = cb.getAttribute('data-id');
        const card = cb.closest('.user-card');
        if (cb.checked) {
          selectedUserIds.add(id);
          if (card) card.classList.add('selected');
        } else {
          selectedUserIds.delete(id);
          if (card) card.classList.remove('selected');
        }
        updateSelectionState();
      }
    });

    // Button actions delegation (delete & copy)
    usersList.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.delete-user-btn');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        const name = delBtn.getAttribute('data-name') || 'this user';
        if (!confirm(`Are you sure you want to delete user "${name}"?\nThis will remove their profile, images, and attendance records.`)) {
          return;
        }
        delBtn.disabled = true;
        delBtn.innerText = 'Deleting...';
        try {
          const res = await fetch('/api/users/' + encodeURIComponent(id), { method: 'DELETE' });
          if (!res.ok) {
            const err = await res.json();
            alert('Failed to delete user: ' + (err.error || res.statusText));
            delBtn.disabled = false;
            delBtn.innerText = 'Delete';
            return;
          }
          selectedUserIds.delete(id);
          await loadUsers();
        } catch (err) {
          alert('Error deleting user: ' + err.message);
          delBtn.disabled = false;
          delBtn.innerText = 'Delete';
        }
        return;
      }

      const copyBtn = e.target.closest('.copy-link');
      if (copyBtn) {
        const url = copyBtn.getAttribute('data-url');
        try {
          await navigator.clipboard.writeText(url);
          alert('Copied URL to clipboard');
        } catch (err) {
          const ta = document.createElement('textarea');
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          alert('Copied URL');
        }
      }
    });
  }

  async function loadUsers(){
    usersList.innerHTML = '<p>Loading users...</p>';
    try{
      const res = await fetch('/api/users');
      if (!res.ok) return usersList.innerText = 'Failed to load users';
      const users = await res.json();

      // Clean up selection for removed users
      const currentIds = new Set(users.map(u => String(u.id)));
      for (const selId of Array.from(selectedUserIds)) {
        if (!currentIds.has(selId)) selectedUserIds.delete(selId);
      }

      if (userCountBadge) userCountBadge.innerText = users.length;

      if (!users.length) {
        usersList.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1;">No registered users found. Use the form above to enroll new users.</div>';
        updateSelectionState();
        return;
      }

      // group by section
      const groups = {};
      users.forEach(u => {
        const key = (u.section || 'Unassigned').trim() || 'Unassigned';
        if (!groups[key]) groups[key] = [];
        groups[key].push(u);
      });

      // render
      usersList.innerHTML = '';
      for (const sectionName of Object.keys(groups).sort()){
        const div = document.createElement('div');
        div.className = 'section-group';
        const h = document.createElement('h4'); h.innerText = sectionName + ` (${groups[sectionName].length})`;
        div.appendChild(h);
        const list = document.createElement('div'); list.className = 'section-list';
        for (const u of groups[sectionName]){
          const isSelected = selectedUserIds.has(String(u.id));
          const card = document.createElement('div'); 
          card.className = 'user-card' + (isSelected ? ' selected' : '');
          card.setAttribute('data-id', u.id);
          const userUrl = window.location.origin + '/api/users/' + encodeURIComponent(u.id);
          const images = Array.isArray(u.images) && u.images.length ? u.images : (u.image ? [u.image] : []);
          const thumbs = images.map(img => `<div class="thumb mini"><img src="${img}" alt="face"></div>`).join('');
          
          card.innerHTML = `
            <div class="card-select-wrap">
              <input type="checkbox" class="user-card-cb" data-id="${u.id}" data-name="${escapeHtml(u.name)}" ${isSelected ? 'checked' : ''} title="Select user">
            </div>
            <div class="thumb-group">${thumbs}</div>
            <div class="meta">
              <strong>${escapeHtml(u.name)}</strong>
              <div class="meta-role">
                <span class="user-designation">${escapeHtml(u.designation || '')}</span>
                ${u.code ? `<span class="user-code">#${escapeHtml(u.code)}</span>` : ''}
              </div>
              <div class="meta-section">
                <span class="badge-section">Section: <strong>${escapeHtml(u.section || u.designation || 'General')}</strong></span>
              </div>
              <div class="small">${new Date(u.createdAt).toLocaleString()}</div>
              <div class="small">Faces: ${images.length}</div>
            </div>
            <div class="qrcol">
              <img class="qr" data-id="${u.id}" src="" alt="QR">
              <div class="links">
                <a class="open-link" href="${userUrl}" target="_blank" rel="noopener">Open</a>
                <button class="copy-link" data-url="${userUrl}">Copy</button>
                <a class="download-qr" download="${u.name.replace(/\s+/g, '_')}-QR.png" style="cursor:pointer; color:#0b63a8; text-decoration:underline;">Download</a>
                <button class="delete-user-btn" data-id="${u.id}" data-name="${escapeHtml(u.name)}" title="Delete User">Delete</button>
              </div>
            </div>`;
          list.appendChild(card);
        }
        div.appendChild(list);
        usersList.appendChild(div);
      }

      updateSelectionState();

      // fetch QR images
      const qImgs = usersList.querySelectorAll('img.qr[data-id]');
      qImgs.forEach(img=>{
        const id = img.getAttribute('data-id');
        fetch('/api/users/' + id + '/qr').then(r=>r.json()).then(o=>{ 
          if (o && o.dataUrl) {
            img.src = o.dataUrl;
            const dl = img.parentElement.querySelector('a.download-qr');
            if (dl) dl.href = o.dataUrl;
          }
        }).catch(()=>{});
      });
    } catch(err){ usersList.innerText = 'Error loading users'; console.error(err); }
  }


  // Attendance report handling
  const loadReportBtn = document.getElementById('loadReportBtn');
  const reportDateInput = document.getElementById('reportDate');
  const reportContainer = document.getElementById('reportContainer');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportXlsxBtn = document.getElementById('exportXlsxBtn');

  if (loadReportBtn) {
    loadReportBtn.addEventListener('click', async ()=>{
      const d = reportDateInput.value || new Date().toISOString().slice(0,10);
      reportContainer.innerHTML = '<p>Loading report...</p>';
      try{
        const res = await fetch('/api/attendance?date=' + encodeURIComponent(d));
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        renderReport(data);
      }catch(err){ reportContainer.innerText = 'Error loading report'; console.error(err); }
    });
  }

  function renderReport(data){
    if (!data || !data.sections) return reportContainer.innerText = 'No data';
    reportContainer.innerHTML = '';
    const sections = data.sections;
    for (const sec of Object.keys(sections).sort()){
      const box = document.createElement('div'); box.className = 'section-group';
      const h = document.createElement('h4'); h.innerText = sec + ` — Present: ${sections[sec].present.length} / Absent: ${sections[sec].absent.length}`;
      box.appendChild(h);
      const presentList = document.createElement('ol'); presentList.style.marginLeft = '18px';
      sections[sec].present.forEach(u => {
        const li = document.createElement('li'); li.innerHTML = `<strong>${u.name}</strong> — ${u.email||''} <span class="small">${u.timeIn?('IN: ' + new Date(u.timeIn).toLocaleTimeString()):''}${u.timeOut?(' / OUT: ' + new Date(u.timeOut).toLocaleTimeString()):''}</span>`;
        presentList.appendChild(li);
      });
      const absentTitle = document.createElement('div'); absentTitle.style.marginTop = '8px'; absentTitle.innerText = 'Absent:';
      const absentList = document.createElement('ol'); absentList.style.marginLeft = '18px';
      sections[sec].absent.forEach(u => { const li = document.createElement('li'); li.innerHTML = `<strong>${u.name}</strong> — ${u.email||''}`; absentList.appendChild(li); });
      box.appendChild(presentList); box.appendChild(absentTitle); box.appendChild(absentList);
      reportContainer.appendChild(box);
    }
  }

  if (exportCsvBtn) exportCsvBtn.addEventListener('click', ()=>{
    const d = reportDateInput.value || new Date().toISOString().slice(0,10);
    window.location.href = `/api/attendance/export?date=${encodeURIComponent(d)}&type=csv`;
  });
  if (exportXlsxBtn) exportXlsxBtn.addEventListener('click', ()=>{
    const d = reportDateInput.value || new Date().toISOString().slice(0,10);
    window.location.href = `/api/attendance/export?date=${encodeURIComponent(d)}&type=xlsx`;
  });
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) exportPdfBtn.addEventListener('click', ()=>{
    const d = reportDateInput.value || new Date().toISOString().slice(0,10);
    window.location.href = `/api/attendance/export?date=${encodeURIComponent(d)}&type=pdf`;
  });
});

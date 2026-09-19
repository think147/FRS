// Auto-redirect HTTP → HTTPS so camera (mediaDevices) works on LAN / public IP
(function enforceHttps() {
  if (
    location.protocol === 'http:' &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1'
  ) {
    const httpsPort = 3443;
    const url = 'https://' + location.hostname + ':' + httpsPort + location.pathname + location.search;
    // Show a short message before redirecting so the user knows what's happening
    document.addEventListener('DOMContentLoaded', function () {
      const body = document.body;
      if (body) {
        body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;font-family:sans-serif;">'
          + '<div style="text-align:center;color:#fff;padding:2rem;">'
          + '<div style="font-size:3rem;margin-bottom:1rem;">🔒</div>'
          + '<h2 style="margin:0 0 0.5rem">Redirecting to Secure Connection</h2>'
          + '<p style="color:#94a3b8;">Camera requires HTTPS. Redirecting you automatically...</p>'
          + '<p style="margin-top:1rem"><a href="' + url + '" style="color:#60a5fa">' + url + '</a></p>'
          + '</div></div>';
      }
    });
    location.replace(url);
    return; // stop rest of script
  }
})();

let html5Scanner = null;
let selectedCameraId = null;
document.addEventListener('DOMContentLoaded', ()=>{
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const startMatchBtn = document.getElementById('startMatchBtn');
  const userImage = document.getElementById('userImage');
  const userName = document.getElementById('userName');
  const userDetails = document.getElementById('userDetails');
  const message = document.getElementById('message');
  const uploadCounts = {};
  let scannedEmployee = null;
  const defaultAvatarSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' stop-color='%230f2c5e'/><stop offset='100%25' stop-color='%230a1a3a'/></linearGradient></defs><rect fill='url(%23g)' width='512' height='512'/><circle cx='256' cy='200' r='90' fill='rgba(255,255,255,0.06)'/><ellipse cx='256' cy='420' rx='150' ry='90' fill='rgba(255,255,255,0.04)'/></svg>";

  // Initial capability check
  (async function detectDevices(){
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      setMessage('Camera API not available in this browser', 'error');
      startBtn.disabled = true;
      return;
    }
    try{
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (!cams || cams.length === 0) {
        setMessage('No camera detected. Connect a camera and reload.', 'error');
        startBtn.disabled = true;
      } else {
        setMessage('Press Start Camera to scan QR', 'info');
        startBtn.disabled = false;
      }
    }catch(e){
      console.error('Device detection failed', e);
      setMessage('Unable to detect camera devices', 'error');
      startBtn.disabled = true;
    }
  })();

  startBtn.addEventListener('click', async ()=>{
    startBtn.disabled = true;
    await startCamera();
    startBtn.disabled = false;
  });

  stopBtn.addEventListener('click', async ()=>{
    stopBtn.disabled = true;
    await stopCamera();
    stopBtn.disabled = false;
  });

  async function startCamera(){
    if (matchStream) stopCameraMatch();
    try{
      await ensureScannerLib();
      const Html5Qrcode = window.Html5Qrcode;
      const cams = await Html5Qrcode.getCameras().catch(async ()=>{
        // fallback to navigator API
        const devs = await navigator.mediaDevices.enumerateDevices();
        return devs.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label }));
      });
      if (!cams || cams.length === 0) throw new Error('No camera found');
      selectedCameraId = selectedCameraId || cams[0].id;
      
      const readerDiv = document.getElementById('reader');
      readerDiv.innerHTML = ''; // clear matchVideo if present

      const formatsToSupport = [
        (window.Html5QrcodeSupportedFormats && window.Html5QrcodeSupportedFormats.QR_CODE !== undefined)
          ? window.Html5QrcodeSupportedFormats.QR_CODE
          : 0
      ];

      html5Scanner = new Html5Qrcode('reader', {
        formatsToSupport,
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      });

      // Scan full camera frame for instant detection anywhere on screen
      await html5Scanner.start(
        selectedCameraId,
        {
          fps: 12,           // Optimal 12 frames/sec for smooth and accurate detection
          disableFlip: false // try both normal and mirrored
        },
        onScanSuccess, onScanError
      );
      stopBtn.style.display = '';
      startBtn.style.display = 'none';
      if (window._uiSetCameraActive) window._uiSetCameraActive(true, 'qr');
      if (window._uiSetStatus) window._uiSetStatus('QR Scanner Ready', 'info');
      if (window._uiSetStep) window._uiSetStep(1);
      setMessage('Step 1: Hold Employee QR code in front of the camera', 'info');
    }catch(err){
      let msg = err && err.message ? err.message : String(err);
      // Friendly mapping for common permission/device errors
      if (/Permission|NotAllowed|denied/i.test(msg)) msg = 'Camera access was denied. Allow camera permission and retry.';
      if (/Overconstrained|No camera/i.test(msg)) msg = 'No compatible camera found.';
      setMessage('Camera start error: ' + msg, 'error');
      if (window._uiSetCameraActive) window._uiSetCameraActive(false);
      startBtn.style.display = '';
      startBtn.disabled = false;
      console.error(err);
    }
  }

  function ensureScannerLib(timeoutMs = 10000){
    return new Promise((resolve, reject)=>{
      if (window.Html5Qrcode) return resolve();
      const loadCDN = ()=>{
        const cdnScript = document.createElement('script');
        // Pin to latest stable version with BarcodeDetector support
        cdnScript.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
        cdnScript.async = true;
        const cdnTimer = setTimeout(()=>{ cdnScript.onerror = null; cdnScript.onload = null; reject(new Error('Failed to load scanner library')); }, timeoutMs);
        cdnScript.onload = ()=>{ clearTimeout(cdnTimer); resolve(); };
        cdnScript.onerror = ()=>{ clearTimeout(cdnTimer); reject(new Error('Failed to load scanner library')); };
        document.head.appendChild(cdnScript);
      };

      // try to load dynamically
      const script = document.createElement('script');
      script.src = '/libs/html5-qrcode.min.js';
      script.async = true;
      const timer = setTimeout(()=>{
        script.onerror = null; script.onload = null;
        loadCDN();
      }, timeoutMs);
      script.onload = ()=>{ clearTimeout(timer); resolve(); };
      script.onerror = ()=>{
        clearTimeout(timer);
        loadCDN();
      };
      document.head.appendChild(script);
    });
  }

  async function stopCamera(){
    if (!html5Scanner) return;
    try{ await html5Scanner.stop(); html5Scanner.clear(); } catch(e){}
    html5Scanner = null;
    stopBtn.style.display = 'none';
    startBtn.style.display = '';
    if (window._uiSetCameraActive) window._uiSetCameraActive(false);
    if (window._uiSetStatus) window._uiSetStatus('Camera Stopped', 'idle');
    setMessage('Camera stopped', 'info');
  }

  let isProcessingQR = false;

  async function onScanSuccess(decodedText){
    if (isProcessingQR) return; // Prevent multiple rapid scans
    isProcessingQR = true;
    try{
      console.log('QR Code scanned successfully:', decodedText);
      // Pause scanning by stopping html5Scanner
      if (html5Scanner) {
        try{ await html5Scanner.stop(); } catch(e){}
      }
      if (window._uiSetCameraActive) window._uiSetCameraActive(false);

      setMessage('QR Code Detected! Retrieving employee record...', 'info');
      if (window._uiSetStatus) window._uiSetStatus('QR Code Detected', 'info');

      // Robust extraction of user ID / Code from decodedText
      let queryId = (decodedText || '').trim();
      const urlMatch = queryId.match(/\/api\/users\/([^\/\?#]+)/i);
      if (urlMatch) {
        queryId = decodeURIComponent(urlMatch[1]);
      } else {
        const paramMatch = queryId.match(/[?&]id=([^&#]+)/i);
        if (paramMatch) {
          queryId = decodeURIComponent(paramMatch[1]);
        }
      }

      // Always request from local relative path to avoid mixed-content or cross-origin blocks
      const fetchUrl = '/api/users/' + encodeURIComponent(queryId);
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error('Employee not found for scanned QR (' + queryId + ')');
      const user = await res.json();
      scannedEmployee = user;

      if (window._uiResetProfile) window._uiResetProfile();
      if (window._uiSetQRDetected) window._uiSetQRDetected(true, 'QR Detected');
      if (window._uiSetStep) window._uiSetStep(2);

      // Do NOT reveal photo yet - keep default avatar until face is detected
      userImage.src = defaultAvatarSvg;
      userName.innerText = user.name || 'Unknown';
      userDetails.innerText = [user.designation, user.section].filter(Boolean).join(' • ') || 'Verifying Face...';
      const userIdElem = document.getElementById('userId');
      if (userIdElem) userIdElem.innerText = 'ID: ' + (user.code || user.id || '');
      
      setMessage(`QR Detected: ${user.name}! Please look at the camera for auto Face Verification.`, 'info');
      if (window._uiSetStatus) window._uiSetStatus(`Verifying Face: ${user.name}`, 'info');

      // Auto start Face Match specifically for this scanned employee
      setTimeout(()=>{ startCameraMatch(user.id); }, 500);
    }catch(err){
      console.error(err);
      setMessage('Scan error: ' + (err && err.message ? err.message : err), 'error');
      if (window._uiSetStatus) window._uiSetStatus('Scan Error', 'error');
      // restart scanner
      setTimeout(()=>{ isProcessingQR = false; startCamera(); }, 2000);
    }
  }

  function onScanError(err){ /* ignore minor scan errors */ }

  function setMessage(text, type){
    // Use premium UI helper if available — MUST be first, before touching message.innerText
    // (message.innerText would destroy the #messageText child span)
    if (window._uiSetMessage) { window._uiSetMessage(text, type); return; }
    // Fallback for plain HTML (no new UI loaded)
    message.innerText = text;
    message.className = 'message' + (type ? ' ' + type : '');
    const banner = document.getElementById('statusBanner');
    if (banner) {
      if (type === 'success') banner.innerText = 'Attendance saved';
      else if (type === 'error') banner.innerText = 'Error';
      else banner.innerText = 'Please scan QR';
    }
  }

  // update clock
  const dtElem = document.getElementById('currentDateTime');
  function updateClock(){
    if (!dtElem) return;
    const now = new Date();
    const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    dtElem.innerText = now.toLocaleDateString(undefined, opts) + '  ' + now.toLocaleTimeString();
  }
  setInterval(updateClock, 1000);
  updateClock();

  // compute SHA-1 hash of a file in browser
  function computeFileHash(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = async ()=>{
        try{
          const arrayBuffer = reader.result;
          const digest = await (crypto.subtle || window.crypto.subtle).digest('SHA-1', arrayBuffer);
          const hashArray = Array.from(new Uint8Array(digest));
          const hashHex = hashArray.map(b=>b.toString(16).padStart(2,'0')).join('');
          resolve(hashHex);
        }catch(e){ reject(e); }
      };
      reader.onerror = (e)=> reject(e);
      reader.readAsArrayBuffer(file);
    });
  }

  // compute average-hash (aHash) of an image file by loading into an Image and drawing to 8x8 canvas
  function computeAHashFromCanvas(canvas){
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0,0,8,8).data;
    const vals = [];
    for (let i=0;i<data.length;i+=4) vals.push(data[i]);
    const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
    let bits = '';
    for (const v of vals) bits += (v > avg ? '1' : '0');
    let hex = '';
    for (let i=0;i<64;i+=4) hex += parseInt(bits.slice(i,i+4),2).toString(16);
    return hex.padStart(16,'0');
  }

  function computeAHashFromFile(file){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      const url = URL.createObjectURL(file);
      img.onload = ()=>{
        try{
          const canvas = document.createElement('canvas');
          canvas.width = 8; canvas.height = 8;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 8, 8);
          const h = computeAHashFromCanvas(canvas);
          URL.revokeObjectURL(url);
          resolve(h);
        }catch(e){ URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function sampleCenterToCanvas(video, canvas){
    const vw = video.videoWidth || 320;
    const vh = video.videoHeight || 240;
    const size = Math.min(vw, vh) * 0.7;
    const sx = Math.max(0, (vw - size) / 2);
    const sy = Math.max(0, (vh - size) / 2);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 8, 8);
  }

  function hammingDistanceHex(hex1, hex2){
    try{
      let v = BigInt('0x' + hex1) ^ BigInt('0x' + hex2);
      let c = 0;
      while (v) { c += Number(v & 1n); v >>= 1n; }
      return c;
    }catch(e){ return 64; }
  }

  // Camera-based matching
  let matchStream = null, matchVideo = null, matchCanvas = null, matchInterval = null;
  let usersCache = [];
  const MATCH_SAMPLE_MS = 100; // 10 fps for faster sampling
  const MATCH_THRESHOLD = 12; // relaxed threshold for better lighting tolerance
  const MATCH_REQUIRED = 2; // only 2 consecutive frames to confirm
  const matchCounts = {}; // userId -> consecutive count

  function sampleCenterToCanvas(video, canvas){
    const vw = video.videoWidth || 320;
    const vh = video.videoHeight || 240;
    const size = Math.min(vw, vh) * 0.7;
    const sx = Math.max(0, (vw - size) / 2);
    const sy = Math.max(0, (vh - size) / 2);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 8, 8);
  }

  function resetToDefaultProfile(){
    scannedEmployee = null;
    userImage.src = defaultAvatarSvg;
    userName.innerText = 'AI Attendance';
    userDetails.innerText = 'Face recognition active';
    const uid = document.getElementById('userId');
    if (uid) uid.innerText = '';
    if (window._uiResetProfile) window._uiResetProfile();
    if (window._uiSetStep) window._uiSetStep(1);
  }

  async function startCameraMatch(targetUserId = null){
    if (matchStream) return;
    try{
      await stopCamera(); // Stop normal camera scan if active
      await new Promise(r => setTimeout(r, 150));
      const constraints = { video: true, audio: false };
      if (selectedCameraId) constraints.video = { deviceId: { exact: selectedCameraId } };
      matchStream = await navigator.mediaDevices.getUserMedia(constraints);
      matchVideo = document.createElement('video');
      matchVideo.autoplay = true; matchVideo.playsInline = true; matchVideo.muted = true;
      matchVideo.style.width = '100%';
      matchVideo.style.height = '100%';
      matchVideo.srcObject = matchStream;
      const readerDiv = document.getElementById('reader');
      readerDiv.innerHTML = '';
      readerDiv.appendChild(matchVideo);
      await matchVideo.play();
      if (window._uiSetCameraActive) window._uiSetCameraActive(true, 'match');
      if (window._uiSetStatus) window._uiSetStatus(targetUserId ? 'Auto Face Detection Active' : 'Face Match Active', 'info');
      if (window._uiSetStep) window._uiSetStep(targetUserId ? 2 : 1);

      // Add scanning animation to avatar
      const overlayEl = document.getElementById('scanOverlay');
      if (overlayEl) overlayEl.classList.add('scanning');
      matchCanvas = document.createElement('canvas'); matchCanvas.width = 8; matchCanvas.height = 8;
      
      const res = await fetch('/api/users');
      usersCache = res.ok ? await res.json() : [];
      let userHashes = usersCache.map(u=>({
        id: u.id,
        name: u.name,
        designation: u.designation,
        email: u.email,
        image: (u.images && u.images[0]) || u.image,
        hashes: Array.from(new Set([].concat(u.imageAHashes || [], u.imageAHash ? [u.imageAHash] : [])))
      }));

      if (targetUserId) {
        userHashes = userHashes.filter(u => u.id === targetUserId);
        if (userHashes.length === 0 || !userHashes[0].hashes || userHashes[0].hashes.length === 0) {
          setMessage(`QR verified, but no face photos enrolled for this employee. Register faces in Admin portal.`, 'error');
          if (window._uiSetStatus) window._uiSetStatus('No Face Enrolled', 'error');
          setTimeout(() => {
            stopCameraMatch();
            resetToDefaultProfile();
            startCamera();
          }, 3500);
          return;
        }
      }

      const matchStartTime = Date.now();
      const MATCH_TIMEOUT_MS = 10000; // 10 second timeout for face verification

      matchInterval = setInterval(()=>{
        try{
          if (!matchVideo || matchVideo.readyState < 2) return;

          // Timeout check when verifying after QR code detection
          if (targetUserId && (Date.now() - matchStartTime > MATCH_TIMEOUT_MS)) {
            clearInterval(matchInterval); matchInterval = null;
            setMessage('Face verification timed out. Please scan QR and try again.', 'error');
            if (window._uiSetStatus) window._uiSetStatus('Face Not Verified', 'error');
            setTimeout(()=>{
              stopCameraMatch();
              resetToDefaultProfile();
              startCamera();
            }, 2500);
            return;
          }

          sampleCenterToCanvas(matchVideo, matchCanvas);
          const h = computeAHashFromCanvas(matchCanvas);
          let best = null; let bestDist = 99;
          for (const uh of userHashes){
            for (const uhHash of uh.hashes){
              const d = hammingDistanceHex(uhHash, h);
              if (d < bestDist){ bestDist = d; best = uh; }
            }
          }
          if (best && bestDist <= MATCH_THRESHOLD){
            matchCounts[best.id] = (matchCounts[best.id] || 0) + 1;
            console.debug('best match', best.id, best.name, bestDist, matchCounts[best.id]);
            setMessage(`Face Detected: ${best.name} • Verifying (${matchCounts[best.id]}/${MATCH_REQUIRED})`, 'info');
            if (matchCounts[best.id] >= MATCH_REQUIRED){
              // Both QR code and Face are now verified - reveal the employee's photo!
              userImage.src = best.image || (best.images && best.images[0]) || (scannedEmployee && (scannedEmployee.image || (scannedEmployee.images && scannedEmployee.images[0]))) || userImage.src;
              userName.innerText = best.name || (scannedEmployee && scannedEmployee.name) || 'Unknown';
              userDetails.innerText = best.designation ? `${best.designation} • ${best.email||''}` : (best.email || '');
              const uid = document.getElementById('userId');
              if (uid) uid.innerText = 'ID: ' + (best.id || '');
              if (window._uiResetProfile) window._uiResetProfile();
              if (window._uiSetQRDetected) window._uiSetQRDetected(true, 'QR + Face Verified');
              if (window._uiSetStep) window._uiSetStep(3);
              
              // Stop match interval to prevent multiple triggers
              clearInterval(matchInterval); matchInterval = null;
              
              fetch('/api/attendance/mark', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ id: best.id }) })
                .then(r => r.json())
                .then(data => {
                  let statusMsg = 'Attendance Saved';
                  let detailMsg = 'Checked In';
                  if (data.already && data.entry && data.entry.timeOut) {
                    statusMsg = 'Attendance Updated';
                    detailMsg = 'Checked Out';
                  }
                  setMessage(`${statusMsg}: ${best.name} (${detailMsg})`, 'success'); 
                  if (window._uiShowSuccess) window._uiShowSuccess(best.name + ' - ' + detailMsg); 
                  if (window._uiSetStatus) window._uiSetStatus(statusMsg, 'success'); 
                  
                  // After successful verification, go back to QR scanning mode
                  setTimeout(()=>{
                    stopCameraMatch();
                    resetToDefaultProfile();
                    startCamera();
                  }, 3500);
                })
                .catch(()=> {
                  setMessage('Attendance saved (mark failed)', 'error');
                  setTimeout(()=>{
                    stopCameraMatch();
                    resetToDefaultProfile();
                    startCamera();
                  }, 3500);
                });
              matchCounts[best.id] = 0;
            }
          } else {
            Object.keys(matchCounts).forEach(k=> matchCounts[k] = Math.max(0, matchCounts[k]-1));
          }
        }catch(e){ console.error('match sample error', e); }
      }, MATCH_SAMPLE_MS);

      if (startMatchBtn) { startMatchBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop Match'; }
      setMessage(targetUserId ? 'QR Detected! Looking at camera for Face Verification...' : 'Face match running…', 'info');
    }catch(e){
      console.error(e);
      setMessage('Camera match failed: ' + (e && e.message ? e.message : e), 'error');
      if (window._uiSetStatus) window._uiSetStatus('Match Failed', 'error');
      stopCameraMatch();
    }
  }

  function stopCameraMatch(){
    if (matchInterval) { clearInterval(matchInterval); matchInterval = null; }
    if (matchVideo) { try{ matchVideo.pause(); }catch(e){} matchVideo = null; }
    if (matchStream) { matchStream.getTracks().forEach(t=>t.stop()); matchStream = null; }
    matchCanvas = null; Object.keys(matchCounts).forEach(k=>delete matchCounts[k]);
    const overlayEl = document.getElementById('scanOverlay');
    if (overlayEl) overlayEl.classList.remove('scanning');
    if (window._uiSetCameraActive) window._uiSetCameraActive(false);
    if (window._uiSetStatus) window._uiSetStatus('System Ready', 'idle');
    if (startMatchBtn) { startMatchBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="18" cy="14" r="3"/><path d="M16.7 17.7L20 21"/></svg> Face Match'; }
    isProcessingQR = false; // Reset debounce flag
  }

  if (startMatchBtn) startMatchBtn.addEventListener('click', ()=>{
    if (matchStream) {
      stopCameraMatch();
      startCamera();
    } else {
      startCameraMatch();
    }
  });

  // Start in QR Code scanning mode automatically (First QR code is detected, then auto face detected)
  setTimeout(() => {
    startCamera();
  }, 400);
});

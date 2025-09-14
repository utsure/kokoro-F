document.addEventListener('DOMContentLoaded', () => {
  // ====== 画面管理と要素参照 ======
  const screens = {
    initial: document.getElementById('screen-initial'),
    introduction: document.getElementById('screen-introduction'),
    fvalue: document.getElementById('screen-fvalue-input'),
    bpm: document.getElementById('screen-bpm'),
    camera: document.getElementById('screen-camera'),
  };
  const video = document.getElementById('video');
  const previewCanvas = document.querySelector('#screen-camera canvas');
  const previewCtx = previewCanvas.getContext('2d');
  
  // 撮影用のオフスクリーンCanvas
  const captureCanvas = document.createElement('canvas');

  let selectedFValue = 22.0;
  let lastMeasuredBpm = 80; // デフォルト値
  let currentStream = null;
  let rafId = null;
  let currentFacing = 'environment';
  const MIN_F = 2.0, MAX_F = 22.0;
  const BPM_MIN = 60, BPM_MAX = 100, DEFAULT_BPM = 80;

  // ====== 画面遷移 ======
  function showScreen(key) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[key]?.classList.add('active');
  }

  // ====== カメラ制御 ======
  async function startCamera(facingMode) {
    stopPreviewLoop();
    if (currentStream) currentStream.getTracks().forEach(track => track.stop());
    try {
      const constraints = { video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      currentStream = stream;
      currentFacing = facingMode;
      startPreviewLoop();
    } catch (err) { alert("カメラの起動に失敗しました。"); }
  }

  // ====== プレビュー処理 (BPMに応じたモーションブラー) ======
  function startPreviewLoop() {
    const render = () => {
      if (video.readyState < 2 || !video.videoWidth) {
        rafId = requestAnimationFrame(render);
        return;
      }

      if (previewCanvas.width !== video.videoWidth) {
        previewCanvas.width = video.videoWidth;
        previewCanvas.height = video.videoHeight;
      }

      const t = (lastMeasuredBpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
      const trailAlpha = 0.5 * (1 - t);

      previewCtx.save();
      previewCtx.globalAlpha = trailAlpha;
      previewCtx.drawImage(previewCanvas, 0, 0);
      previewCtx.restore();
      
      previewCtx.save();
      previewCtx.globalAlpha = 1.0 - trailAlpha;
      if (currentFacing === 'user') {
        previewCtx.translate(previewCanvas.width, 0);
        previewCtx.scale(-1, 1);
      }
      previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
      previewCtx.restore();

      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
  }
  function stopPreviewLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  
  // ====== フィルター効果 ======
  function getFilterString(f) {
      const t = (f - MIN_F) / (MAX_F - MIN_F);
      const brightness = 1.8 - (t * 1.5);
      const blur = (1 - t) * 10;
      return `brightness(${brightness.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
  }

  function applyPreviewFilter(f) {
      previewCanvas.style.filter = getFilterString(f);
  }

  // ====== F値入力画面のロジック ======
  const apertureControl = document.querySelector('.aperture-control');
  const fValueDisplay = document.getElementById('f-value-display');
  const apertureInput = document.getElementById('aperture');
  const MIN_SIZE = 100, MAX_SIZE = 250;
  const fToSize = f => MIN_SIZE + ((MAX_F - f) / (MAX_F - MIN_F)) * (MAX_SIZE - MIN_SIZE);
  let currentFValue = selectedFValue;

  function updateApertureUI(f) {
    const clampedF = Math.max(MIN_F, Math.min(MAX_F, f));
    apertureControl.style.width = apertureControl.style.height = `${fToSize(clampedF)}px`;
    const roundedF = Math.round(clampedF * 10) / 10;
    fValueDisplay.textContent = roundedF.toFixed(1);
    apertureInput.value = roundedF;
  }
  updateApertureUI(currentFValue);

  let lastPinchDistance = 0;
  const getDistance = (t1, t2) => Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
  document.body.addEventListener('touchstart', e => {
    if (screens.fvalue.classList.contains('active') && e.touches.length === 2) {
      e.preventDefault(); lastPinchDistance = getDistance(e.touches[0], e.touches[1]);
    }
  }, { passive: false });
  document.body.addEventListener('touchmove', e => {
    if (screens.fvalue.classList.contains('active') && e.touches.length === 2 && lastPinchDistance > 0) {
      e.preventDefault();
      const dist = getDistance(e.touches[0], e.touches[1]);
      const delta = lastPinchDistance - dist;
      currentFValue += delta * 0.1;
      updateApertureUI(currentFValue);
      lastPinchDistance = dist;
    }
  }, { passive: false });

  // ====== BPM計測画面のロジック ======
  const bpmVideo = document.getElementById('bpm-video');
  const bpmStatus = document.getElementById('bpm-status');
  
  async function startBpmCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        bpmVideo.srcObject = stream;
    } catch (e) { alert("BPM用カメラを開始できません"); }
  }
  function stopBpmCamera() {
    if (bpmVideo.srcObject) { bpmVideo.srcObject.getTracks().forEach(t => t.stop()); bpmVideo.srcObject = null; }
  }
  
  async function goToCameraScreen(bpm) {
      stopBpmCamera();
      lastMeasuredBpm = bpm || DEFAULT_BPM;
      showScreen('camera');
      document.getElementById('fvalue-display-camera').textContent = `F: ${selectedFValue.toFixed(1)}`;
      document.getElementById('bpm-display-camera').textContent = `BPM: ${lastMeasuredBpm}`;
      applyPreviewFilter(selectedFValue);
      await startCamera('environment');
  }

  // ====== 撮影機能 ======
  async function captureWithMotionBlur(ctx, video, bpm) {
    const numFrames = Math.max(1, Math.round(1 + (BPM_MAX - bpm) / (BPM_MAX - BPM_MIN) * 24));
    ctx.globalAlpha = 1.0 / numFrames;
    for (let i = 0; i < numFrames; i++) {
        ctx.save();
        if (currentFacing === 'user') {
            ctx.translate(ctx.canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
        if (i < numFrames - 1) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }
    ctx.globalAlpha = 1.0;
  }

  document.getElementById('camera-shutter-btn')?.addEventListener('click', async () => {
    const shutterBtn = document.getElementById('camera-shutter-btn');
    if (shutterBtn.disabled || !video.videoWidth) return;
    shutterBtn.disabled = true;
    try {
      captureCanvas.width  = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');
      ctx.filter = getFilterString(selectedFValue);
      await captureWithMotionBlur(ctx, video, lastMeasuredBpm);
      ctx.filter = 'none';
      captureCanvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cocoro_photo_${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.9);
    } catch (err) {
      console.error('撮影エラー:', err);
      alert('撮影に失敗しました。');
    } finally {
      shutterBtn.disabled = false;
    }
  });

  // ====== イベントリスナー設定 ======
  document.getElementById('initial-next-btn')?.addEventListener('click', () => showScreen('introduction'));
  
  // ★ 修正点：この一行が抜けていました
  document.getElementById('intro-next-btn')?.addEventListener('click', () => showScreen('fvalue'));
  
  document.getElementById('f-value-decide-btn')?.addEventListener('click', () => {
    selectedFValue = parseFloat(document.getElementById('aperture').value);
    showScreen('bpm');
    startBpmCamera();
  });
  
  document.getElementById('bpm-start-btn')?.addEventListener('click', () => {
    bpmStatus.textContent = "計測中...";
    // ここに実際のBPM計測ロジックを実装します
    // 現在は3秒後にランダムな値でカメラ画面に遷移します
    setTimeout(() => {
        const bpm = Math.round(Math.random() * (BPM_MAX - BPM_MIN) + BPM_MIN);
        goToCameraScreen(bpm);
    }, 3000);
  });
  
  document.getElementById('bpm-skip-btn')?.addEventListener('click', () => goToCameraScreen(DEFAULT_BPM));
  
  document.getElementById('camera-switch-btn')?.addEventListener('click', () => {
    const nextFacing = (currentFacing === 'user') ? 'environment' : 'user';
    startCamera(nextFacing);
  });
  
  // ====== 初期化 ======
  showScreen('initial');
});

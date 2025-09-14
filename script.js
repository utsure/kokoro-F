document.addEventListener('DOMContentLoaded', () => {
  // ====== グローバル変数と定数 ======
  const screens = {
    initial: document.getElementById('screen-initial'),
    introduction: document.getElementById('screen-introduction'),
    fvalue: document.getElementById('screen-fvalue-input'),
    bpm: document.getElementById('screen-bpm'),
    camera: document.getElementById('screen-camera'),
  };
  const T = { /* 文言データは変更なしのため省略 */ };
  
  let currentStream = null, rafId = null, currentFacing = 'environment';
  let selectedFValue = 22.0, lastMeasuredBpm = 80;
  const MIN_F = 2.0, MAX_F = 22.0, DEFAULT_BPM = 80;
  const BPM_MIN = 60, BPM_MAX = 100;

  const video = document.getElementById('video');
  const captureCanvas = document.getElementById('capture-canvas');
  const previewCanvas = document.createElement('canvas');
  const previewCtx = previewCanvas.getContext('2d');
  if (screens.camera) screens.camera.insertBefore(previewCanvas, video);

  // ====== 画面管理 ======
  function showScreen(key) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[key].classList.add('active');
  }

  // ====== カメラ制御 ======
  async function startCamera(facingMode) {
    stopPreviewLoop();
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    try {
      const constraints = { video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      currentStream = stream;
      currentFacing = facingMode;
      startPreviewLoop();
    } catch (err) { alert("カメラを開始できませんでした。"); }
  }

  function startPreviewLoop() {
    const render = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (previewCanvas.width !== video.videoWidth) {
          previewCanvas.width = video.videoWidth;
          previewCanvas.height = video.videoHeight;
        }
        previewCtx.save();
        if (currentFacing === 'user') {
          previewCtx.translate(previewCanvas.width, 0);
          previewCtx.scale(-1, 1);
        }
        previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
        previewCtx.restore();
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
  }
  function stopPreviewLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }

  // ====== フィルター効果 (プレビューと撮影結果を同期) ======
  function getFilterString(f) {
    const t = (f - MIN_F) / (MAX_F - MIN_F); // 0.0 (F2.0) to 1.0 (F22.0)
    const brightness = 1.8 - (t * 1.5); // F値が小さいほど明るく
    const blur = (1 - t) * 10; // F値が小さいほどボケる
    return `brightness(${brightness.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
  }

  function applyPreviewFilter(f) {
    previewCanvas.style.filter = getFilterString(f);
  }

  // ====== F値入力画面 ======
  const apertureControl = document.querySelector('.aperture-control');
  const fValueDisplay = document.getElementById('f-value-display');
  const apertureInput = document.getElementById('aperture-value-input');
  const MIN_SIZE = 100, MAX_SIZE = 250;
  const fToSize = f => MIN_SIZE + ((MAX_F - f) / (MAX_F - MIN_F)) * (MAX_SIZE - MIN_SIZE);
  let currentFValue = selectedFValue;

  function updateApertureUI(f) {
    const clampedF = Math.max(MIN_F, Math.min(MAX_F, f));
    apertureControl.style.width = apertureControl.style.height = `${fToSize(clampedF)}px`;
    fValueDisplay.textContent = clampedF.toFixed(1);
    apertureInput.value = clampedF;
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
    if (screens.fvalue.classList.contains('active') && e.touches.length === 2) {
      e.preventDefault();
      const dist = getDistance(e.touches[0], e.touches[1]);
      const delta = lastPinchDistance - dist;
      currentFValue += delta * 0.1;
      updateApertureUI(currentFValue);
      lastPinchDistance = dist;
    }
  }, { passive: false });

  // ====== BPM計測画面 ======
  const bpmVideo = document.getElementById('bpm-video');
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
    lastMeasuredBpm = bpm;
    showScreen('camera');
    document.getElementById('fvalue-display-camera').textContent = `F: ${selectedFValue.toFixed(1)}`;
    document.getElementById('bpm-display-camera').textContent = `BPM: ${bpm}`;
    applyPreviewFilter(selectedFValue);
    await startCamera('environment');
  }

  // ====== ★ 撮影機能 (安定版) ======
  async function takePhoto() {
    if (!video.videoWidth) {
      alert("カメラの準備ができていません。");
      return;
    }
    const shutterBtn = document.getElementById('camera-shutter-btn');
    shutterBtn.disabled = true;

    try {
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');
      ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
      
      // プレビューと同じフィルターを適用
      ctx.filter = getFilterString(selectedFValue);

      // BPMに応じたモーションブラー
      const bpm = lastMeasuredBpm || DEFAULT_BPM;
      // BPM:60 -> 15フレーム, BPM:100 -> 1フレーム
      const numFrames = Math.max(1, Math.round(1 + (BPM_MAX - bpm) / (BPM_MAX - BPM_MIN) * 14));
      ctx.globalAlpha = 1.0 / numFrames;

      for (let i = 0; i < numFrames; i++) {
          ctx.save();
          if (currentFacing === 'user') {
              ctx.translate(captureCanvas.width, 0);
              ctx.scale(-1, 1);
          }
          ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
          ctx.restore();
          // requestAnimationFrameで待機することで、スムーズな描画を保証
          if (i < numFrames - 1) {
              await new Promise(resolve => requestAnimationFrame(resolve));
          }
      }
      
      // 後処理
      ctx.globalAlpha = 1.0;
      ctx.filter = 'none';

      // 画像をBlobとして取得し、ダウンロード
      captureCanvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cocoro_photo_${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.9);

    } catch (err) {
      console.error("撮影に失敗しました:", err);
      alert("写真の撮影中にエラーが発生しました。");
    } finally {
      shutterBtn.disabled = false;
    }
  }

  // ====== イベントリスナー設定 ======
  document.getElementById('initial-next-btn').addEventListener('click', () => showScreen('introduction'));
  document.getElementById('intro-next-btn').addEventListener('click', () => showScreen('fvalue'));
  document.getElementById('f-value-decide-btn').addEventListener('click', () => {
    selectedFValue = parseFloat(apertureInput.value);
    showScreen('bpm');
    startBpmCamera();
  });
  document.getElementById('bpm-start-btn').addEventListener('click', () => {
    // ここに実際のBPM測定ロジックを入れる
    setTimeout(() => goToCameraScreen(Math.round(Math.random() * (BPM_MAX - BPM_MIN) + BPM_MIN)), 3000);
  });
  document.getElementById('bpm-skip-btn').addEventListener('click', () => goToCameraScreen(DEFAULT_BPM));
  document.getElementById('camera-switch-btn').addEventListener('click', () => {
    const nextFacing = (currentFacing === 'user') ? 'environment' : 'user';
    startCamera(nextFacing);
  });
  document.getElementById('camera-shutter-btn').addEventListener('click', takePhoto);

  // ====== 初期化 ======
  applyTexts(T); // 文言を反映
  showScreen('initial');
});

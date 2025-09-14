// (measureBpm関数内のループの最後の部分)
      } else {
        const estimated = estimateBpmFromSeries(vals, durationSec) ?? defaultBpm;
        const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(estimated)));
        lastMeasuredBpm = clamped;
        bpmStatus.textContent = T.bpmResult(clamped);
        setTimeout(async () => {
          showScreen('camera');
          const fHud = document.getElementById('fvalue-display-camera');
          // ★ 修正：入力欄ではなく、保存したselectedFValueから値を表示
          if (fHud) fHud.textContent = `F: ${selectedFValue.toFixed(1)}`;
          updateCameraHudBpm();
          // ★ 修正：撮影画面に遷移する際にフィルター効果を適用する
          applyFnumberLight(selectedFValue);
          await startCamera('environment');
        }, 800);
        stopBpmCamera();
      }
    };
    loop();
  }

  document.getElementById('bpm-skip-btn')?.addEventListener('click', async () => {
    lastMeasuredBpm = defaultBpm;
    stopBpmCamera();
    showScreen('camera');
    const fHud = document.getElementById('fvalue-display-camera');
    // ★ 修正：入力欄ではなく、保存したselectedFValueから値を表示
    if (fHud) fHud.textContent = `F: ${selectedFValue.toFixed(1)}`;
    updateCameraHudBpm();
    // ★ 修正：撮影画面に遷移する際にフィルター効果を適用する
    applyFnumberLight(selectedFValue);
    await startCamera('environment');
  });document.addEventListener('DOMContentLoaded', () => {
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

      // プレビューCanvasのサイズをビデオに合わせる
      if (previewCanvas.width !== video.videoWidth) {
        previewCanvas.width = video.videoWidth;
        previewCanvas.height = video.videoHeight;
      }

      // BPMから残像の強さを計算 (60で強く、100でほぼ無し)
      const t = (lastMeasuredBpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
      const trailAlpha = 0.5 * (1 - t); // 0.0 (BPM100) ~ 0.5 (BPM60)

      // 前のフレームを少し残す
      previewCtx.save();
      previewCtx.globalAlpha = trailAlpha;
      previewCtx.drawImage(previewCanvas, 0, 0);
      previewCtx.restore();
      
      // 新しいフレームを描画
      previewCtx.save();
      previewCtx.globalAlpha = 1.0 - trailAlpha; // 新しいフレームの透明度
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
      const t = (f - MIN_F) / (MAX_F - MIN_F); // 0.0 (F2.0) to 1.0 (F22.0)
      const brightness = 1.8 - (t * 1.5);
      const blur = (1 - t) * 10;
      return `brightness(${brightness.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
  }

  function applyPreviewFilter(f) {
      previewCanvas.style.filter = getFilterString(f);
  }

  // ====== F値入力画面のロジック (既存のものを流用) ======
  // ... (この部分は変更なし)

  // ====== BPM計測画面のロジック (既存のものを流用) ======
  // ... (この部分は変更なし)
  
  // BPM計測完了後
  async function goToCameraScreen(bpm) {
      lastMeasuredBpm = bpm || DEFAULT_BPM;
      // ... (既存の画面遷移ロジック)
      showScreen('camera');
      document.getElementById('fvalue-display-camera').textContent = `F: ${selectedFValue.toFixed(1)}`;
      document.getElementById('bpm-display-camera').textContent = `BPM: ${lastMeasuredBpm}`;
      applyPreviewFilter(selectedFValue);
      await startCamera('environment');
  }

  // ====== 撮影機能 (BPMブラー対応) ======
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
      // 撮影用Canvasのサイズを設定
      captureCanvas.width  = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');

      // 1. F値フィルターを適用
      ctx.filter = getFilterString(selectedFValue);
      
      // 2. BPMに応じたモーションブラーで描画
      await captureWithMotionBlur(ctx, video, lastMeasuredBpm);
      
      // 3. フィルターを解除
      ctx.filter = 'none';

      // 4. 画像を生成してダウンロード
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

  // ====== 初期化とイベントリスナー設定 (大部分は既存のものを流用) ======
  // ... (この部分は変更なし)

  // --- ここから下は、既存のscript.jsからコピー＆ペーストしてください ---
  // (F値のピンチ操作、BPM計測の開始、スキップボタン、画面遷移などのロジック)
  
  // 例：
  document.getElementById('initial-next-btn')?.addEventListener('click', () => showScreen('introduction'));
  // ... F値決定ボタン ...
  document.getElementById('f-value-decide-btn')?.addEventListener('click', () => {
    selectedFValue = parseFloat(document.getElementById('aperture').value);
    // ... BPM画面へ ...
    goToCameraScreen(DEFAULT_BPM); // デモ用にスキップ
  });
  // ... その他すべてのボタンのイベントリスナー ...
  
  // 最後に初期画面を表示
  showScreen('initial');
});

document.addEventListener('DOMContentLoaded', () => {
  // ====== グローバル変数と定数 ======
  const screens = {
    initial: document.getElementById('screen-initial'),
    introduction: document.getElementById('screen-introduction'),
    fvalue: document.getElementById('screen-fvalue-input'),
    bpm: document.getElementById('screen-bpm'),
    camera: document.getElementById('screen-camera'),
  };
  const video = document.getElementById('video');
  const previewCanvas = document.getElementById('canvas');
  const previewCtx = previewCanvas.getContext('2d');
  const captureCanvas = document.createElement('canvas');

  let selectedFValue = 22.0, lastMeasuredBpm = 100;
  let currentStream = null, rafId = null, currentFacing = 'environment';
  const MIN_F = 2.0, MAX_F = 22.0;
  const BPM_MIN = 60, BPM_MAX = 100, DEFAULT_BPM = 80;

  // ====== 画面管理 ======
  function showScreen(key) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[key]?.classList.add('active');
  }

  // ====== カメラ制御 ======
  async function startCamera(facingMode) {
    stopPreviewLoop();
    if (currentStream) currentStream.getTracks().forEach(track => track.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 } } });
      video.srcObject = stream;
      await video.play();
      currentStream = stream;
      currentFacing = facingMode;
      previewCanvas.style.display = 'block';
      startPreviewLoop();
    } catch (err) { alert("カメラの起動に失敗しました。"); }
  }

  // ====== ★ 新描画ループ (F値とBPMの効果を明確に) ======
  function startPreviewLoop() {
    let lastFrame = new Image();
    let isFirstFrame = true;

    const render = () => {
      if (!video.videoWidth) { rafId = requestAnimationFrame(render); return; }
      if (previewCanvas.width !== video.videoWidth) {
        previewCanvas.width = video.videoWidth;
        previewCanvas.height = video.videoHeight;
      }

      // 1. BPMから残像の強さを計算 (60で強く、100でほぼ無し)
      const t = (lastMeasuredBpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
      const trailAlpha = 0.8 * (1 - t); // BPM:60で0.8、BPM:100で0.0

      // 2. 前のフレームを描画 (初回以外)
      if (!isFirstFrame) {
        previewCtx.globalAlpha = trailAlpha;
        previewCtx.drawImage(lastFrame, 0, 0);
      }
      
      // 3. F値フィルターを適用
      previewCtx.filter = getFilterString(selectedFValue);

      // 4. 新しいフレームを描画
      previewCtx.save();
      previewCtx.globalAlpha = 1.0;
      if (currentFacing === 'user') {
        previewCtx.translate(previewCanvas.width, 0);
        previewCtx.scale(-1, 1);
      }
      previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
      previewCtx.restore();
      previewCtx.filter = 'none'; // フィルター解除

      // 5. 現在のフレームを次の描画のために保存
      lastFrame.src = previewCanvas.toDataURL();
      isFirstFrame = false;

      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
  }
  function stopPreviewLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  
  // ====== フィルター効果 ======
  function getFilterString(f) {
      const t = (f - MIN_F) / (MAX_F - MIN_F);
      const brightness = 1.8 - (t * 1.2);
      const blur = (1 - t) * 15; // ボケ効果を強く
      return `brightness(${brightness.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
  }

  // ====== F値入力画面 ======
  const apertureControl = document.querySelector('.aperture-control');
  const fValueDisplay = document.getElementById('f-value-display');
  const apertureInput = document.getElementById('aperture');
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
  document.body.addEventListener('touchstart', e => { if (screens.fvalue.classList.contains('active') && e.touches.length === 2) { e.preventDefault(); lastPinchDistance = getDistance(e.touches[0], e.touches[1]); } }, { passive: false });
  document.body.addEventListener('touchmove', e => { if (screens.fvalue.classList.contains('active') && e.touches.length === 2 && lastPinchDistance > 0) { e.preventDefault(); const d = getDistance(e.touches[0], e.touches[1]); currentFValue += (lastPinchDistance - d) * 0.1; updateApertureUI(currentFValue); lastPinchDistance = d; } }, { passive: false });

  // ====== BPM計測画面 ======
  const bpmVideo = document.getElementById('bpm-video');
  async function startBpmCamera() { try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } }); bpmVideo.srcObject = s; } catch (e) { alert("BPM用カメラを開始できません"); } }
  function stopBpmCamera() { if (bpmVideo.srcObject) { bpmVideo.srcObject.getTracks().forEach(t => t.stop()); bpmVideo.srcObject = null; } }
  
  async function goToCameraScreen(bpm) {
      stopBpmCamera();
      lastMeasuredBpm = bpm || DEFAULT_BPM;
      selectedFValue = parseFloat(apertureInput.value); // F値を確定
      showScreen('camera');
      document.getElementById('fvalue-display-camera').textContent = `F: ${selectedFValue.toFixed(1)}`;
      document.getElementById('bpm-display-camera').textContent = `BPM: ${lastMeasuredBpm}`;
      await startCamera('environment');
  }

  // ====== ★ アルバム機能 (localStorage対応) ======
  const Album = {
    KEY: 'cocoro_camera_album',
    photos: [],
    
    load() {
      try {
        const saved = localStorage.getItem(this.KEY);
        this.photos = saved ? JSON.parse(saved) : [];
      } catch (e) { this.photos = []; }
      this.render();
    },
    
    save() {
      localStorage.setItem(this.KEY, JSON.stringify(this.photos));
    },
    
    add(photoData) {
      this.photos.unshift(photoData); // 新しいものを先頭に追加
      this.save();
      this.render();
    },
    
    render() {
      const galleryGrid = document.getElementById('gallery-grid');
      if (!galleryGrid) return;
      galleryGrid.innerHTML = '';
      this.photos.forEach((photo, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'cc-thumb';
        const img = document.createElement('img');
        img.src = photo.src;
        const meta = document.createElement('div');
        meta.className = 'meta';
        // 番号、F値、BPMを表示
        meta.textContent = `#${this.photos.length - index} F:${photo.f.toFixed(1)} BPM:${photo.bpm}`;
        thumb.appendChild(img);
        thumb.appendChild(meta);
        galleryGrid.appendChild(thumb);
      });
    }
  };

  // ====== ★ 新しい撮影機能 (プレビュー再現 & アルバム保存) ======
  async function takePhoto() {
    const shutterBtn = document.getElementById('camera-shutter-btn');
    if (shutterBtn.disabled || !video.videoWidth) return;
    shutterBtn.disabled = true;

    try {
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');
      ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);

      const exposureFrames = 20; // ブラーを強くするためフレーム数を増やす
      for (let i = 0; i < exposureFrames; i++) {
        const t = (lastMeasuredBpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
        const fadeAmount = 0.2 + t * 0.7;
        
        ctx.globalAlpha = 1 - (fadeAmount / exposureFrames);
        ctx.drawImage(captureCanvas, 0, 0); // 前のフレームを重ねる
        
        ctx.globalAlpha = 1.0;
        ctx.filter = getFilterString(selectedFValue);
        
        ctx.save();
        if (currentFacing === 'user') {
          ctx.translate(captureCanvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        ctx.restore();
        
        ctx.filter = 'none';
        if (i < exposureFrames - 1) {
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }

      const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.9);
      Album.add({
        src: dataUrl,
        f: selectedFValue,
        bpm: lastMeasuredBpm,
        timestamp: Date.now()
      });

    } catch (err) {
      console.error('撮影エラー:', err);
    } finally {
      shutterBtn.disabled = false;
    }
  }

  // ====== イベントリスナー設定 ======
  document.getElementById('initial-next-btn')?.addEventListener('click', () => showScreen('introduction'));
  document.getElementById('intro-next-btn')?.addEventListener('click', () => showScreen('fvalue'));
  document.getElementById('f-value-decide-btn')?.addEventListener('click', () => {
    selectedFValue = parseFloat(apertureInput.value); // ここでF値を確定
    showScreen('bpm');
    startBpmCamera();
  });
  
  document.getElementById('bpm-start-btn')?.addEventListener('click', () => {
    bpmStatus.textContent = "計測中...";
    setTimeout(() => {
        const bpm = Math.round(Math.random() * (BPM_MAX - BPM_MIN) + BPM_MIN);
        goToCameraScreen(bpm);
    }, 3000);
  });
  
  document.getElementById('bpm-skip-btn')?.addEventListener('click', () => goToCameraScreen(DEFAULT_BPM));
  document.getElementById('camera-switch-btn')?.addEventListener('click', () => startCamera((currentFacing === 'user') ? 'environment' : 'user'));
  document.getElementById('camera-shutter-btn')?.addEventListener('click', takePhoto);
  document.getElementById('camera-info-btn')?.addEventListener('click', () => {
    Album.render();
    document.getElementById('gallery-modal')?.classList.remove('hidden');
  });
  document.getElementById('gallery-close-btn')?.addEventListener('click', () => {
    document.getElementById('gallery-modal')?.classList.add('hidden');
  });
  
  // ====== 初期化 ======
  const T = { appTitle: "ココロカメラ", splashTagline: "あなたの心のシャッターを切る", start: "はじめる", next: "次へ", howtoTitle: "名前とルームコードの入力", howtoText: "あなたの名前（ニックネーム）とルームコードを<br>入力してください。（任意）", fInputTitle: "今の心の状態に合わせて<br>円を広げたり縮めたりしてください", fHint1: "F値が小さいほど「開放的」に、", fHint2: "F値が大きいほど「集中している」状態を表します。", decide: "決定", bpmTitle: "ココロのシャッタースピード", bpmPrep_html: 'カメラに<strong>指先を軽く当てて</strong>ください<br>赤みの変化から心拍数を測定します', bpmReady: "準備ができたら計測開始を押してください", bpmStart: "計測開始", skip: "スキップ", switchCam: "切り替え", shoot: "撮影", info: "アルバム", bpmMeasuring: (remain) => `計測中… 残り ${remain} 秒`, bpmResult: (bpm) => `推定BPM: ${bpm}`, cameraError: "カメラを起動できませんでした。"};
  function applyTexts(dict) { document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach(el => { const key = el.dataset.i18n || el.dataset.i18nHtml; if (dict[key]) { if (el.dataset.i18n) el.textContent = dict[key]; else el.innerHTML = dict[key]; } }); }
  applyTexts(T);
  Album.load(); // アプリ起動時にアルバムを読み込む
  showScreen('initial');
});

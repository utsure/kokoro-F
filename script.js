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
  // HTML内のcanvasをプレビュー用として使用
  const previewCanvas = document.getElementById('canvas'); 
  const previewCtx = previewCanvas.getContext('2d');
  
  // 撮影処理に使う非表示のCanvas
  const captureCanvas = document.createElement('canvas');

  let selectedFValue = 22.0;
  let lastMeasuredBpm = 100; // 初期状態ではブレがないように最大値に設定
  let currentStream = null;
  let rafId = null;
  let currentFacing = 'environment';
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
      const constraints = { video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      currentStream = stream;
      currentFacing = facingMode;
      // HTML内のcanvasを表示状態にする
      previewCanvas.style.display = 'block';
      startPreviewLoop();
    } catch (err) { alert("カメラの起動に失敗しました。"); }
  }

  // ====== ★ 新しい描画ループ (F値とBPMの効果を統合) ======
  function startPreviewLoop() {
    const render = () => {
      if (!video.videoWidth) {
        rafId = requestAnimationFrame(render);
        return;
      }
      if (previewCanvas.width !== video.videoWidth) {
        previewCanvas.width = video.videoWidth;
        previewCanvas.height = video.videoHeight;
      }

      // 1. BPMから残像の強さ（フェードアウトの速さ）を計算
      // BPM 60で弱くフェード(0.1)、100で強くフェード(0.9) = ほぼ残像なし
      const t = (lastMeasuredBpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
      const fadeAmount = 0.1 + t * 0.8;
      
      // 2. 前のフレームをフェードアウトさせる
      previewCtx.fillStyle = `rgba(0, 0, 0, ${fadeAmount})`;
      previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

      // 3. F値からフィルター（ボケと明るさ）を設定
      previewCtx.filter = getFilterString(selectedFValue);

      // 4. 新しいビデオフレームを描画
      previewCtx.save();
      if (currentFacing === 'user') {
        previewCtx.translate(previewCanvas.width, 0);
        previewCtx.scale(-1, 1);
      }
      previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
      previewCtx.restore();

      // 5. フィルターをリセット
      previewCtx.filter = 'none';

      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
  }
  function stopPreviewLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  
  // ====== フィルター効果 ======
  function getFilterString(f) {
      const t = (f - MIN_F) / (MAX_F - MIN_F); // 0.0 (F2.0) to 1.0 (F22.0)
      const brightness = 1.8 - (t * 1.5); // F値が低いほど明るく
      const blur = (1 - t) * 12; // F値が低いほどボケる (最大12px)
      return `brightness(${brightness.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
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
      // プレビュー開始時にフィルターが適用されるので、ここでの適用は不要
      await startCamera('environment');
  }

  // ====== ★ 新しい撮影機能 (プレビューを完全に再現) ======
  async function takePhoto() {
    const shutterBtn = document.getElementById('camera-shutter-btn');
    if (shutterBtn.disabled || !video.videoWidth) return;
    shutterBtn.disabled = true;

    try {
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');
      ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);

      // プレビューの描画ロジックを短時間実行して、撮影結果を生成
      const exposureFrames = 15; // 15フレーム分の光を蓄積するイメージ
      for (let i = 0; i < exposureFrames; i++) {
        const t = (lastMeasuredBpm - BPM_MIN) / (BPM_MAX - BPM_MIN);
        const fadeAmount = 0.1 + t * 0.8;
        
        ctx.fillStyle = `rgba(0, 0, 0, ${fadeAmount})`;
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
        
        ctx.filter = getFilterString(selectedFValue);
        
        ctx.save();
        if (currentFacing === 'user') {
          ctx.translate(captureCanvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        ctx.restore();
        
        ctx.filter = 'none';
        
        // 次のフレームを待つ
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      // 画像を生成してダウンロード
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
  }

  // ====== イベントリスナー設定 ======
  document.getElementById('initial-next-btn')?.addEventListener('click', () => showScreen('introduction'));
  document.getElementById('intro-next-btn')?.addEventListener('click', () => showScreen('fvalue'));
  document.getElementById('f-value-decide-btn')?.addEventListener('click', () => {
    selectedFValue = parseFloat(apertureInput.value);
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
  
  document.getElementById('camera-switch-btn')?.addEventListener('click', () => {
    const nextFacing = (currentFacing === 'user') ? 'environment' : 'user';
    startCamera(nextFacing);
  });
  
  document.getElementById('camera-shutter-btn')?.addEventListener('click', takePhoto);
  
  // ====== 初期化 ======
  // 文言データ
  const T = { appTitle: "ココロカメラ", splashTagline: "あなたの心のシャッターを切る", start: "はじめる", next: "次へ", howtoTitle: "名前とルームコードの入力", howtoText: "あなたの名前（ニックネーム）とルームコードを<br>入力してください。（任意）", fInputTitle: "今の心の状態に合わせて<br>円を広げたり縮めたりしてください", fHint1: "F値が小さいほど「開放的」に、", fHint2: "F値が大きいほど「集中している」状態を表します。", decide: "決定", bpmTitle: "ココロのシャッタースピード", bpmPrep_html: 'カメラに<strong>指先を軽く当てて</strong>ください<br>赤みの変化から心拍数を測定します', bpmReady: "準備ができたら計測開始を押してください", bpmStart: "計測開始", skip: "スキップ", switchCam: "切り替え", shoot: "撮影", info: "アルバム", bpmMeasuring: (remain) => `計測中… 残り ${remain} 秒`, bpmResult: (bpm) => `推定BPM: ${bpm}`, cameraError: "カメラを起動できませんでした。"};
  function applyTexts(dict) { document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach(el => { const key = el.dataset.i18n || el.dataset.i18nHtml; if (dict[key]) { if (el.dataset.i18n) el.textContent = dict[key]; else el.innerHTML = dict[key]; } }); }
  applyTexts(T);
  showScreen('initial');
});

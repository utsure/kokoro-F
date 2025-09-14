document.addEventListener('DOMContentLoaded', () => {
  // ====== グローバル変数と定数 ======
  const screens = {
    initial: document.getElementById('screen-initial'),
    // introduction: document.getElementById('screen-introduction'), // 削除
    fvalue: document.getElementById('screen-fvalue-input'),
    bpm: document.getElementById('screen-bpm'),
    camera: document.getElementById('screen-camera'),
  };

  // F値入力画面用の要素
  const apertureControl = document.querySelector('.aperture-control');
  const fValueDisplay = document.getElementById('f-value-display');
  const fValueDecideBtn = document.getElementById('f-value-decide-btn'); // 追加
  const apertureInput = document.getElementById('aperture'); // hidden input

  // BPM測定画面用の要素
  const bpmVideo = document.getElementById('bpm-video');
  const bpmStartBtn = document.getElementById('bpm-start-btn');
  const bpmSkipBtn = document.getElementById('bpm-skip-btn');
  const bpmStatus = document.getElementById('bpm-status');

  // ★ カメラ撮影画面用の要素 (以前のindex.htmlから移植)
  const cameraVideo = document.getElementById("camera-video"); // 撮影画面のvideo要素
  const cameraCanvas = document.getElementById("camera-canvas"); // 撮影画面のcanvas要素
  const cameraCtx = cameraCanvas.getContext("2d", { willReadFrequently: true });
  const cameraFValueDisplay = document.getElementById("camera-f-value"); // 撮影画面のF値表示 (info-box内)
  const cameraBpmValueDisplay = document.getElementById("camera-bpm-value"); // 撮影画面のBPM表示 (info-box内)
  const cameraCenterCircle = document.getElementById("center-circle"); // 撮影画面のF値円
  const cameraShutterButton = document.getElementById("shutter-button"); // 撮影画面のシャッター
  const cameraSwitchButton = document.getElementById("switch-camera-button"); // 撮影画面のカメラ切替
  const cameraAlbumButton = document.getElementById("album-button"); // 撮影画面のアルバムボタン
  const cameraGallery = document.getElementById("gallery"); // 撮影画面のギャラリー

  const graphCanvas = document.getElementById("graph"); // 撮影画面のグラフcanvas
  const graphCtx = graphCanvas.getContext("2d");

  // アプリケーション共通の変数
  let currentFValueApp = 22.0; // アプリケーション全体で使うF値
  let currentBpmApp = 80; // アプリケーション全体で使うBPM

  let currentCameraStream = null;
  let currentCameraFacingMode = 'environment'; // 'environment' or 'user'

  // F値の範囲
  const MIN_F_APP = 2.0;
  const MAX_F_APP = 22.0;

  // F値入力画面のピンチ操作用の変数
  let fInputPinchInitialDistance = 0;
  let fInputCurrentRadius = 0;
  const MIN_CIRCLE_SIZE = 100; // F値入力画面の円の最小サイズ
  const MAX_CIRCLE_SIZE = 250; // F値入力画面の円の最大サイズ

  // 撮影画面のF値ピンチ操作用の変数 (以前のコードから)
  let cameraFScale = 0.25; // F値のスケール (0.25-4.0)
  const MIN_F_SCALE = 0.25;
  const MAX_F_SCALE = 4.0;
  let lastCameraPinchDistance = 0;

  // BPM測定の変数 (以前のコードから)
  let isBpmMeasuring = false;
  let bpmHistory = [];
  const BPM_MIN = 60;
  const BPM_MAX = 100;

  // ====== 画面管理 ======
  function showScreen(key) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[key]?.classList.add('active');

    // スクリーン切り替え時の特殊処理
    if (key === 'bpm') {
      startBpmCamera();
    } else {
      stopBpmCamera();
    }

    if (key === 'camera') {
      // カメラ画面に遷移する際、F値設定画面で設定されたF値を初期値として使う
      // cameraFScaleをcurrentFValueAppに基づいて初期化する
      cameraFScale = ((MAX_F_APP - currentFValueApp) / (MAX_F_APP - MIN_F_APP)) * (MAX_F_SCALE - MIN_F_SCALE) + MIN_F_SCALE;
      cameraFScale = Math.max(MIN_F_SCALE, Math.min(MAX_F_SCALE, cameraFScale));

      startCameraScreen(currentCameraFacingMode);
    } else {
      stopCameraScreen();
    }
  }

  // ====== F値入力画面 ======
  const fToCircleSize = f => MIN_CIRCLE_SIZE + ((MAX_F_APP - f) / (MAX_F_APP - MIN_F_APP)) * (MAX_CIRCLE_SIZE - MIN_CIRCLE_SIZE);
  
  function updateApertureUI(f) {
    const cF = Math.max(MIN_F_APP, Math.min(MAX_F_APP, f));
    const size = fToCircleSize(cF);
    apertureControl.style.width = apertureControl.style.height = `${size}px`;
    fValueDisplay.textContent = cF.toFixed(1);
    apertureInput.value = cF.toFixed(1); // 隠しinputにも設定
    currentFValueApp = cF; // アプリ全体で使うF値を更新
  }
  updateApertureUI(currentFValueApp); // 初期表示

  // F値設定画面のピンチジェスチャー
  apertureControl.addEventListener("touchstart", (e) => {
    e.preventDefault(); // 画面全体のスクロールや拡大を防止
    if (e.touches.length === 2) {
      fInputPinchInitialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      fInputCurrentRadius = parseFloat(apertureControl.style.width || apertureControl.offsetWidth);
    }
  }, { passive: false });

  apertureControl.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const currentPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const scaleFactor = currentPinchDistance / fInputPinchInitialDistance;
      
      let newSize = fInputCurrentRadius * scaleFactor;
      newSize = Math.max(MIN_CIRCLE_SIZE, Math.min(MAX_CIRCLE_SIZE, newSize));

      // 新しいサイズからF値を逆算
      let newFValue = MAX_F_APP - ((newSize - MIN_CIRCLE_SIZE) / (MAX_CIRCLE_SIZE - MIN_CIRCLE_SIZE)) * (MAX_F_APP - MIN_F_APP);
      newFValue = Math.max(MIN_F_APP, Math.min(MAX_F_APP, newFValue));

      updateApertureUI(newFValue);
    }
  }, { passive: false });

  // ====== BPM測定画面 ======
  async function startBpmCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      bpmVideo.srcObject = stream;
      await bpmVideo.play();
    } catch (e) {
      console.error("BPM用カメラを開始できません", e);
      alert("BPM測定用のカメラを開始できませんでした。");
      showScreen('fvalue'); // カメラ起動失敗したらF値設定画面に戻る
    }
  }
  function stopBpmCamera() {
    if (bpmVideo.srcObject) {
      bpmVideo.srcObject.getTracks().forEach(t => t.stop());
      bpmVideo.srcObject = null;
    }
  }
  async function goToCameraScreenFromBPM(bpm) {
    stopBpmCamera();
    currentBpmApp = bpm || 80; // BPMが取得できなかったらデフォルト
    // currentFValueApp はF値設定画面から既に設定されている
    showScreen('camera');
  }


  // ====== ★ 撮影画面のロジック (以前のコードを移植・調整) ======

  async function startCameraScreen(facingMode) {
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(track => track.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      currentCameraStream = stream;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      currentCameraFacingMode = facingMode;
      resizeCameraCanvas(); // キャンバスサイズ調整
      
      // カメラ画面のF値とBPM表示を更新 (currentFValueApp と currentBpmApp を使用)
      updateCameraFValueDisplay(); // 初期F値に基づきUIを更新
      cameraBpmValueDisplay.textContent = currentBpmApp > 0 ? currentBpmApp : "---";
      
      startCameraLoop(); // カメラ画面のループ開始
    } catch (e) {
      console.error("カメラの起動に失敗しました:", e);
      alert("カメラの起動に失敗しました。");
      showScreen('bpm'); // 失敗したらBPM画面に戻る
    }
  }

  function stopCameraScreen() {
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(track => track.stop());
      currentCameraStream = null;
    }
    stopCameraLoop(); // カメラ画面のループ停止
  }

  let cameraLoopId = null;
  function startCameraLoop() {
    if (cameraLoopId) cancelAnimationFrame(cameraLoopId); // 既存のループがあれば停止
    const loop = () => {
      if (cameraVideo.readyState >= 2) {
        // currentFValueApp はピンチ操作で更新されるため、ここでフィルターを適用
        cameraVideo.style.filter = computeCssFilter(currentFValueApp);
        cameraVideo.style.transform = (currentCameraFacingMode === 'user') ? 'scaleX(-1)' : 'none';
      }
      cameraLoopId = requestAnimationFrame(loop);
    };
    cameraLoopId = requestAnimationFrame(loop);
  }

  function stopCameraLoop() {
    if (cameraLoopId) {
      cancelAnimationFrame(cameraLoopId);
      cameraLoopId = null;
    }
  }

  function resizeCameraCanvas() {
    if (cameraVideo.videoWidth > 0) {
      cameraCanvas.width = cameraVideo.videoWidth;
      cameraCanvas.height = cameraVideo.videoHeight;
    }
    if (graphCanvas.parentElement) {
      graphCanvas.width = graphCanvas.parentElement.clientWidth;
      graphCanvas.height = graphCanvas.parentElement.clientHeight;
    }
  }
  cameraVideo.addEventListener('loadedmetadata', resizeCameraCanvas);
  window.addEventListener('resize', resizeCameraCanvas);


  // F値の計算とUI更新 (撮影画面用)
  function updateCameraFValueDisplay() {
    // スケール値(0.25-4.0)をF値(22-2)に変換
    currentFValueApp = Math.round((MAX_F_SCALE - cameraFScale) / (MAX_F_SCALE - MIN_F_SCALE) * (MAX_F_APP - MIN_F_APP) + MIN_F_APP);
    currentFValueApp = Math.max(MIN_F_APP, Math.min(MAX_F_APP, currentFValueApp)); // 範囲を保証

    cameraCenterCircle.textContent = currentFValueApp;
    cameraFValueDisplay.textContent = currentFValueApp;
    cameraVideo.style.filter = computeCssFilter(currentFValueApp); // リアルタイムでF値フィルターを適用
    
    // 円のサイズも更新
    const radius = 150 * cameraFScale;
    cameraCenterCircle.style.width = radius + "px";
    cameraCenterCircle.style.height = radius + "px";
  }

  // F値からCSSフィルター文字列を生成
  function computeCssFilter(apValue) {
    const blurPx = Math.max(0, (MAX_F_APP - apValue) / (MAX_F_APP - MIN_F_APP) * 15);
    const brightness = 0.8 + (MAX_F_APP - apValue) / (MAX_F_APP - MIN_F_APP) * 0.7;
    return `blur(${blurPx.toFixed(1)}px) brightness(${brightness.toFixed(2)})`;
  }

  // グラフ描画 (撮影画面用)
  function drawBpmGraph() {
    if (bpmHistory.length === 0) {
      graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      return;
    }

    const arr = bpmHistory.slice(-graphCanvas.width).map(o => o.v);
    if (arr.length < 2) { graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height); return; }

    const min = Math.min(...arr);
    const max = Math.max(...arr);
    graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    graphCtx.beginPath();
    arr.forEach((v, i) => {
      const x = (i / arr.length) * graphCanvas.width;
      const y = graphCanvas.height - ((v - min) / (max - min + 1e-6)) * graphCanvas.height;
      i === 0 ? graphCtx.moveTo(x, y) : graphCtx.lineTo(x, y);
    });
    graphCtx.strokeStyle = "#0f8";
    graphCtx.lineWidth = 1.5;
    graphCtx.stroke();
  }

  // BPM計算 (撮影画面用、基本使わないが念のため)
  function calcBpmFromHistory() {
    if (bpmHistory.length < 30) return 0;
    const relevantHistory = bpmHistory.filter(o => (Date.now() - o.t) < 8000);
    if (relevantHistory.length < 30) return 0;

    const vals = relevantHistory.map(o => o.v);
    const times = relevantHistory.map(o => o.t);
    const n = vals.length;
    if (n === 0) return 0;

    const mean = vals.reduce((a, b) => a + b) / n;
    const detrended = vals.map(v => v - mean);

    const real = new Array(n).fill(0);
    const imag = new Array(n).fill(0);

    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * t * k) / n;
        real[k] += detrended[t] * Math.cos(angle);
        imag[k] -= detrended[t] * Math.sin(angle);
      }
    }

    const power = real.map((r, i) => Math.hypot(r, imag[i]));
    const duration = (times[times.length - 1] - times[0]) / 1000;

    if (duration < 5) return 0;

    const freqResolution = 1 / duration;
    let maxPower = 0;
    let dominantBpm = 0;

    for (let i = 0; i < n / 2; i++) {
      const currentBpm = i * freqResolution * 60;
      if (currentBpm >= BPM_MIN && currentBpm <= BPM_MAX) {
        if (power[i] > maxPower) {
          maxPower = power[i];
          dominantBpm = currentBpm;
        }
      }
    }
    return Math.round(dominantBpm);
  }


  // モーションブラーをかけながら画像を取得
  async function captureWithMotionBlur(targetCtx, videoElement, bpmValue, width, height) {
    if (bpmValue < BPM_MIN || bpmValue > BPM_MAX) {
      targetCtx.drawImage(videoElement, 0, 0, width, height);
      return;
    }
    const numFrames = Math.round(1 + (BPM_MAX - bpmValue) / (BPM_MAX - BPM_MIN) * 15);
    targetCtx.globalAlpha = 1.0 / numFrames;
    targetCtx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < numFrames; i++) {
      targetCtx.drawImage(videoElement, 0, 0, width, height);
      if (i < numFrames - 1) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    targetCtx.globalAlpha = 1.0;
    targetCtx.globalCompositeOperation = 'source-over';
  }

  // 位置情報取得ヘルパー
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error("Geolocation not supported."));
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 8000,
        enableHighAccuracy: true
      });
    });
  }

  // アルバム関連 (撮影画面用)
  const ALBUM_KEY = "fshutter_album";
  function addPhotoToAlbum(photoData) {
    const entry = document.createElement("div");
    entry.className = "entry";
    const img = document.createElement("img");
    img.src = photoData.src;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = photoData.meta;
    entry.appendChild(img);
    entry.appendChild(meta);
    cameraGallery.prepend(entry);
  }
  function saveAlbumToLocalStorage(){
    const entries = [];
    cameraGallery.querySelectorAll(".entry").forEach(entry => {
      const img = entry.querySelector("img");
      const meta = entry.querySelector(".meta");
      entries.push({ src: img.src, meta: meta.textContent });
    });
    localStorage.setItem(ALBUM_KEY, JSON.stringify(entries));
  }
  function loadAlbumFromLocalStorage(){
    const saved = localStorage.getItem(ALBUM_KEY);
    if(saved){
      const arr = JSON.parse(saved);
      for (let i = arr.length - 1; i >= 0; i--) {
        addPhotoToAlbum(arr[i]);
      }
    }
  }


  // ====== イベントリスナー設定 ======
  document.getElementById('initial-next-btn')?.addEventListener('click', () => showScreen('fvalue')); // 初期画面 -> F値設定画面

  // F値設定画面 -> BPM測定画面
  fValueDecideBtn?.addEventListener('click', () => {
    showScreen('bpm');
  });

  // BPM測定開始ボタン (BPM画面用)
  bpmStartBtn?.addEventListener('click', () => {
    if(isBpmMeasuring) return;
    isBpmMeasuring = true;
    bpmHistory = [];
    bpmStatus.textContent = "測定中...";
    setTimeout(() => {
      isBpmMeasuring = false;
      const newBpm = calcBpmFromHistory();
      currentBpmApp = (newBpm >= BPM_MIN && newBpm <= BPM_MAX) ? newBpm : 0;
      bpmStatus.textContent = currentBpmApp > 0 ? `推定BPM: ${currentBpmApp}` : "測定できませんでした";
      goToCameraScreenFromBPM(currentBpmApp); // カメラ画面へ
    }, 8000); // 8秒間測定
  });

  // BPMスキップボタン
  bpmSkipBtn?.addEventListener('click', () => goToCameraScreenFromBPM(80)); // デフォルト80BPMでカメラ画面へ


  // ★ 撮影画面のイベントリスナー (ピンチイン、シャッター、アルバム、カメラ切替)
  const eventStopper = (e) => e.preventDefault(); // 意図しないスクロールやズームを防止

  cameraVideo.addEventListener("touchstart", (e) => {
    eventStopper(e);
    if(e.touches.length === 2){
      lastCameraPinchDistance = Math.hypot( e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY );
    }
  }, { passive: false });
  cameraVideo.addEventListener("touchmove", (e) => {
    eventStopper(e);
    if(e.touches.length === 2){
      const d = Math.hypot( e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY );
      cameraFScale += (d - lastCameraPinchDistance) * 0.005; // ピンチの動きに合わせてスケールを調整
      lastCameraPinchDistance = d;
      cameraFScale = Math.min(Math.max(cameraFScale, MIN_F_SCALE), MAX_F_SCALE); // 範囲を制限
      updateCameraFValueDisplay(); // UIとF値フィルターを更新
    }
  }, { passive: false });


  cameraShutterButton.onclick = async () => {
    if (cameraShutterButton.classList.contains('disabled')) return;
    cameraShutterButton.classList.add('disabled');

    try {
        let position = null;
        let locationString = "位置情報なし";
        try {
            position = await getLocation();
            locationString = `Lat:${position.coords.latitude.toFixed(5)} Lon:${position.coords.longitude.toFixed(5)}`;
        } catch (error) {
            console.warn("位置情報取得エラー:", error.message);
        }
        
        cameraCanvas.width = cameraVideo.videoWidth;
        cameraCanvas.height = cameraVideo.videoHeight;
        
        cameraCtx.save();
        if (currentCameraFacingMode === 'user') {
            cameraCtx.translate(cameraCanvas.width, 0);
            cameraCtx.scale(-1, 1);
        }
        cameraCtx.filter = computeCssFilter(currentFValueApp);
        await captureWithMotionBlur(cameraCtx, cameraVideo, currentBpmApp, cameraCanvas.width, cameraCanvas.height);
        cameraCtx.restore();
        
        let imageUrl = cameraCanvas.toDataURL("image/jpeg", 0.9);

        if (position && window.piexif) {
            try {
                const now = new Date();
                const dateStr = `${now.getFullYear()}:${(now.getMonth()+1).toString().padStart(2,'0')}:${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
                const exifObj = {
                    "0th": { [piexif.ImageIFD.Software]: "ココロカメラ", [piexif.ImageIFD.DateTime]: dateStr, },
                    "Exif": { [piexif.ExifIFD.DateTimeOriginal]: dateStr, [piexif.ExifIFD.DateTimeDigitized]: dateStr, [piexif.ExifIFD.UserComment]: piexif.tools.asciiToBytes(`F:${currentFValueApp},BPM:${currentBpmApp}`) },
                    "GPS": {
                        [piexif.GPSIFD.GPSDateStamp]: `${now.getUTCFullYear()}:${(now.getUTCMonth()+1).toString().padStart(2,'0')}:${now.getUTCDate().toString().padStart(2,'0')}`,
                        [piexif.GPSIFD.GPSTimeStamp]: [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()],
                        [piexif.GPSIFD.GPSLatitudeRef]: position.coords.latitude < 0 ? 'S' : 'N',
                        [piexif.GPSIFD.GPSLatitude]: piexif.GPSHelper.degToDms(position.coords.latitude),
                        [piexif.GPSIFD.GPSLongitudeRef]: position.coords.longitude < 0 ? 'W' : 'E',
                        [piexif.GPSIFD.GPSLongitude]: piexif.GPSHelper.degToDms(position.coords.longitude),
                    }
                };
                const exifBytes = piexif.dump(exifObj);
                imageUrl = piexif.insert(exifBytes, imageUrl);
            } catch (exifError) { console.error("EXIF埋め込み失敗:", exifError); }
        }

        const metaBPM = (currentBpmApp >= BPM_MIN && currentBpmApp <= BPM_MAX) ? `${currentBpmApp} BPM` : "--- BPM";
        const metaText = `F${currentFValueApp}\n${metaBPM}\n${locationString}\n${new Date().toLocaleString('ja-JP')}`;
        
        addPhotoToAlbum({ src: imageUrl, meta: metaText });
        saveAlbumToLocalStorage();

        const blob = await fetch(imageUrl).then(res => res.blob());
        const fileName = `F-Shutter_${new Date().getTime()}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        
        if (navigator.share && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'ココロカメラで撮影した写真' });
        } else {
            const a = document.createElement("a"); a.href = imageUrl; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
    } catch (error) {
        console.error("撮影処理エラー:", error);
        alert("写真の撮影または保存に失敗しました。");
    } finally {
        cameraShutterButton.classList.remove('disabled');
    }
  };

  cameraAlbumButton.onclick = () => { cameraGallery.style.display = cameraGallery.style.display === "none" ? "flex" : "none"; };
  cameraSwitchButton.onclick = async () => {
    currentCameraFacingMode = (currentCameraFacingMode === 'environment') ? 'user' : 'environment';
    await startCameraScreen(currentCameraFacingMode);
  };


  // ====== 初期化 ======
  const T = { appTitle: "ココロカメラ", splashTagline: "あなたの心のシャッターを切る", start: "はじめる", howtoTitle: "名前とルームコードの入力", howtoText: "あなたの名前（ニックネーム）とルームコードを<br>入力してください。（任意）", fInputTitle: "今の心の状態に合わせて<br>円を広げたり縮めたりしてください", fHint1: "F値が小さいほど「開放的」に、", fHint2: "F値が大きいほど「集中している」状態を表します。", decide: "決定", bpmTitle: "ココロのシャッタースピード", bpmPrep_html: 'カメラに<strong>指先を軽く当てて</strong>ください<br>赤みの変化から心拍数を測定します', bpmReady: "準備ができたら計測開始を押してください", bpmStart: "計測開始", skip: "スキップ", switchCam: "切り替え", shoot: "撮影", info: "アルバム", bpmMeasuring: (remain) => `計測中… 残り ${remain} 秒`, bpmResult: (bpm) => `推定BPM: ${bpm}`, cameraError: "カメラを起動できませんでした。"};
  function applyTexts(dict) { document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach(el => { const key = el.dataset.i18n || el.dataset.i18nHtml; if (dict[key]) { if (el.dataset.i18n) el.textContent = dict[key]; else el.innerHTML = dict[key]; } }); }
  applyTexts(T);

  // アプリ起動時にアルバムを読み込む
  loadAlbumFromLocalStorage();
  
  // 初期画面を表示
  showScreen('initial');

  // 常にBPMグラフを動かすためにメインループとは別にアニメーション
  let bpmGraphLoopId = null;
  const startBpmGraphLoop = () => {
    if (bpmGraphLoopId) cancelAnimationFrame(bpmGraphLoopId);
    const loop = () => {
      // このグラフはBPM測定画面でのみ使うため、isBpmMeasuring が true の場合のみ描画
      if (isBpmMeasuring) {
        drawBpmGraph(); // BPM測定画面のグラフを描画
      }
      bpmGraphLoopId = requestAnimationFrame(loop);
    };
    bpmGraphLoopId = requestAnimationFrame(loop);
  };
  startBpmGraphLoop();

});

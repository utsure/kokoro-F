document.addEventListener('DOMContentLoaded', () => {
  // ====== グローバル変数と定数 ======
  const screens = {
    initial: document.getElementById('screen-initial'),
    fvalue: document.getElementById('screen-fvalue-input'),
    bpm: document.getElementById('screen-bpm'),
    camera: document.getElementById('screen-camera'),
  };

  // F値入力画面用の要素
  const apertureControl = document.querySelector('.aperture-control');
  const fValueDisplaySetup = document.getElementById('f-value-display-setup'); // 衝突を避けるためID変更
  const fValueDecideBtn = document.getElementById('f-value-decide-btn');

  // BPM測定画面用の要素
  const bpmVideo = document.getElementById('bpm-video');
  const bpmStartBtn = document.getElementById('bpm-start-btn');
  const bpmSkipBtn = document.getElementById('bpm-skip-btn');
  const bpmStatus = document.getElementById('bpm-status');

  // ★ カメラ撮影画面用の要素 (ご提示いただいたHTMLからIDを統一) ★
  const cameraVideo = document.getElementById("camera-video"); // 撮影画面のvideo要素
  const cameraCanvas = document.getElementById("camera-canvas"); // 撮影画面のcanvas要素
  const cameraCtx = cameraCanvas.getContext("2d", { willReadFrequently: true });
  const cameraBpmValueDisplay = document.getElementById("camera-bpm-value"); // 撮影画面のBPM表示 (info-box内)
  const cameraFValueDisplay = document.getElementById("camera-f-value"); // 撮影画面のF値表示 (info-box内)
  const cameraCenterCircle = document.getElementById("center-circle"); // 撮影画面のF値円
  const cameraShutterButton = document.getElementById("shutter-button"); // 撮影画面のシャッター
  const cameraSwitchButton = document.getElementById("switch-camera-button"); // 撮影画面のカメラ切替
  const cameraAlbumButton = document.getElementById("album-button"); // 撮影画面のアルバムボタン
  const cameraGallery = document.getElementById("gallery"); // 撮影画面のギャラリー
  const cameraStartBpmButton = document.getElementById("start-bpm-button"); // 撮影画面のBPM測定ボタン (元々あったもの)

  const graphCanvas = document.getElementById("graph"); // 撮影画面のグラフcanvas
  const graphCtx = graphCanvas.getContext("2d");


  // アプリケーション共通の変数
  let globalFValue = 22; // アプリケーション全体で使うF値（初期値22）
  let globalBpm = 0; // アプリケーション全体で使うBPM（初期値0）

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

  // 撮影画面のF値ピンチ操作用の変数 (ご提示いただいたコードをそのまま利用)
  let cameraScale = 0.25; // F値のスケール (0.25-4.0)
  const MIN_CAMERA_SCALE = 0.25;
  const MAX_CAMERA_SCALE = 4.0;
  let lastCameraPinchDistance = 0;

  // BPM測定の変数 (ご提示いただいたコードをそのまま利用)
  let isBpmMeasuringOnCamera = false; // カメラ画面でのBPM測定中フラグ
  let cameraBpmHistory = []; // カメラ画面でのBPM履歴
  const BPM_MIN = 60;
  const BPM_MAX = 100;


  // ====== 画面管理 ======
  function showScreen(key) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[key]?.classList.add('active');

    // 全てのカメラ/ビデオストリームを停止
    stopAllCameraStreams();

    // 各スクリーンに特化した処理
    if (key === 'bpm') {
      startBpmMeasurementScreenCamera();
      globalBpm = 0; // BPM測定画面に来たらリセット
      bpmStatus.textContent = T.bpmReady;
    } else if (key === 'camera') {
      startCameraScreen(currentCameraFacingMode, globalFValue, globalBpm);
    }
  }

  function stopAllCameraStreams() {
    // BPM測定画面のカメラ停止
    if (bpmVideo.srcObject) {
      bpmVideo.srcObject.getTracks().forEach(t => t.stop());
      bpmVideo.srcObject = null;
    }
    // 撮影画面のカメラ停止
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(track => track.stop());
      currentCameraStream = null;
    }
    // カメラ画面のループ停止
    if (cameraLoopId) {
      cancelAnimationFrame(cameraLoopId);
      cameraLoopId = null;
    }
  }

  // ====== F値入力画面 ======
  const fToCircleSize = f => MIN_CIRCLE_SIZE + ((MAX_F_APP - f) / (MAX_F_APP - MIN_F_APP)) * (MAX_CIRCLE_SIZE - MIN_CIRCLE_SIZE);
  
  function updateApertureUI(f) {
    const cF = Math.max(MIN_F_APP, Math.min(MAX_F_APP, f));
    const size = fToCircleSize(cF);
    apertureControl.style.width = apertureControl.style.height = `${size}px`;
    fValueDisplaySetup.textContent = cF.toFixed(1);
    globalFValue = cF; // アプリ全体で使うF値を更新
  }
  updateApertureUI(globalFValue); // 初期表示

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
  async function startBpmMeasurementScreenCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      bpmVideo.srcObject = stream;
      await bpmVideo.play();
    } catch (e) {
      console.error("BPM用カメラを開始できません", e);
      alert("BPM測定用のカメラを開始できませんでした。次の画面に進みます。");
      // カメラ起動失敗したらBPMスキップと同じ挙動にする
      goToCameraScreenFromBPM(0); // 0は測定できなかったことを示す
    }
  }

  async function goToCameraScreenFromBPM(bpmValue) {
    globalBpm = bpmValue > 0 ? bpmValue : 0; // BPMが取得できなかったら0
    showScreen('camera');
  }


  // ====== ★ 撮影画面のロジック (ご提示いただいたコードをベースに統合・調整) ★ ======
  let cameraLoopId = null;

  // F値からCSSフィルター文字列を生成 (ご提示いただいた関数をそのまま利用)
  function computeCssFilter(apValue) { 
    const blurPx = Math.max(0, (22 - apValue) / 20 * 10); 
    const brightness = 2.0 - (apValue / 22); 
    return `blur(${blurPx.toFixed(1)}px) brightness(${brightness.toFixed(2)})`; 
  }

  // 円のサイズを更新 (ご提示いただいた関数をそのまま利用)
  function updateCameraCircleSize() { 
    const radius = 150 * cameraScale; 
    cameraCenterCircle.style.width = radius + "px"; 
    cameraCenterCircle.style.height = radius + "px"; 
  }
  
  // F値表示を更新 (ご提示いただいた関数をそのまま利用)
  function updateCameraFValueDisplay() { 
    globalFValue = Math.round((cameraScale - MIN_CAMERA_SCALE) / (MAX_CAMERA_SCALE - MIN_CAMERA_SCALE) * (MIN_F_APP - MAX_F_APP) + MAX_F_APP); 
    globalFValue = Math.max(MIN_F_APP, Math.min(MAX_F_APP, globalFValue)); // 範囲を保証
    cameraCenterCircle.textContent = globalFValue; 
    cameraFValueDisplay.textContent = globalFValue; 
    cameraVideo.style.filter = computeCssFilter(globalFValue); // フィルターをリアルタイム適用
  }


  async function startCameraScreen(facingMode, initialFValue, initialBpm) {
    // F値とBPMの初期値を設定
    globalFValue = initialFValue;
    globalBpm = initialBpm;

    // F値スケールの初期化（globalFValueに基づく）
    cameraScale = ((MAX_F_APP - globalFValue) / (MAX_F_APP - MIN_F_APP)) * (MAX_CAMERA_SCALE - MIN_CAMERA_SCALE) + MIN_CAMERA_SCALE;
    cameraScale = Math.max(MIN_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, cameraScale));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      currentCameraStream = stream;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      currentCameraFacingMode = facingMode;
      
      resizeCameraCanvas(); // キャンバスサイズ調整
      
      // カメラ画面のF値とBPM表示を更新
      updateCameraFValueDisplay();
      updateCameraCircleSize();
      cameraBpmValueDisplay.textContent = globalBpm > 0 ? globalBpm : "---";
      
      startCameraLoop(); // カメラ画面のループ開始
    } catch (e) {
      console.error("カメラの起動に失敗しました:", e);
      alert("カメラの起動に失敗しました。");
      showScreen('bpm'); // 失敗したらBPM画面に戻る
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


  // カメラ画面のメインループ (ご提示いただいたloop関数を参考に調整)
  function startCameraLoop() {
    if (cameraLoopId) cancelAnimationFrame(cameraLoopId); // 既存のループがあれば停止
    const loop = () => {
      if (cameraVideo.readyState >= 2) {
        cameraVideo.style.filter = computeCssFilter(globalFValue); // グローバルF値に基づいてフィルターを適用
        cameraVideo.style.transform = (currentCameraFacingMode === 'user') ? 'scaleX(-1)' : 'none';

        cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
        if (isBpmMeasuringOnCamera) { // カメラ画面でのBPM測定中
          cameraCtx.filter = 'none'; // BPM測定時はフィルターなしで描画
          cameraCtx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
          const size = 100;
          const x = (cameraCanvas.width - size) / 2;
          const y = (cameraCanvas.height - size) / 2;
          const imgData = cameraCtx.getImageData(x, y, size, size);
          let sum = 0;
          for(let i=0; i<imgData.data.length; i+=4) {
            sum += (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
          }
          const avg = sum / (imgData.data.length/4);
          cameraBpmHistory.push({v: avg, t: Date.now()});
          if(cameraBpmHistory.length > 512) cameraBpmHistory.shift();
        }
        drawBpmGraphOnCamera(); // カメラ画面のグラフを描画
      }
      cameraLoopId = requestAnimationFrame(loop);
    };
    cameraLoopId = requestAnimationFrame(loop);
  }

  // グラフ描画 (カメラ画面用, ご提示いただいた関数をそのまま利用)
  function drawBpmGraphOnCamera() { 
    if (cameraBpmHistory.length === 0) {
      graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      return;
    }
    const arr = cameraBpmHistory.slice(-graphCanvas.width).map(o => o.v); 
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

  // BPM計算 (カメラ画面用, ご提示いただいた関数をそのまま利用)
  function calcBpmOnCamera() { 
    if (cameraBpmHistory.length < 30) return 0; 
    const vals = cameraBpmHistory.map(o => o.v); 
    const times = cameraBpmHistory.map(o => o.t); 
    const mean = vals.reduce((a,b) => a + b) / vals.length; 
    const cen = vals.map(v => v - mean); 
    const n = cen.length; 
    const re = new Array(n).fill(0), im = new Array(n).fill(0); 
    for (let k=0; k<n; k++) { 
      for (let t=0; t<n; t++) { 
        const ang = (2 * Math.PI * t * k) / n; 
        re[k] += cen[t] * Math.cos(ang); 
        im[k] -= cen[t] * Math.sin(ang); 
      } 
    } 
    const power = re.map((r,i) => Math.hypot(r, im[i])); 
    const dur = (times[times.length-1] - times[0]) / 1000; 
    if (dur < 5) return 0; 
    const freqRes = 1 / dur; 
    const peaks = power.map((p,i) => ({bpm: i * freqRes * 60, power: p})).filter(o => o.bpm >= BPM_MIN && o.bpm <= BPM_MAX); 
    if (!peaks.length) return 0; 
    return Math.round(peaks.reduce((a,b) => a.power > b.power ? a : b).bpm); 
  }


  // モーションブラーをかけながら画像を取得 (ご提示いただいた関数をそのまま利用)
  async function captureWithMotionBlur(tc, videoElement, bpmValue, width, height) { 
    if (bpmValue < BPM_MIN || bpmValue > BPM_MAX) { 
      tc.drawImage(videoElement, 0, 0, width, height); 
      return; 
    } 
    const numFrames = Math.round(1 + (BPM_MAX - bpmValue) / (BPM_MAX - BPM_MIN) * 24); 
    tc.globalAlpha = 1.0 / numFrames; 
    for (let i = 0; i < numFrames; i++) { 
      tc.drawImage(videoElement, 0, 0, width, height); 
      if (i < numFrames - 1) { 
        await new Promise(resolve => requestAnimationFrame(resolve)); 
      } 
    } 
    tc.globalAlpha = 1.0; 
    tc.globalCompositeOperation = 'source-over'; // リセット
  }

  // 位置情報取得ヘルパー (ご提示いただいた関数をそのまま利用)
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

  // アルバム関連 (ご提示いただいた関数をそのまま利用)
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
    cameraGallery.prepend(entry); // 新しい写真を先頭に追加
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
      arr.forEach(item => { 
        const entry = document.createElement("div"); 
        entry.className = "entry"; 
        const img = document.createElement("img"); 
        img.src = item.src; 
        const meta = document.createElement("div"); 
        meta.className = "meta"; 
        meta.textContent = item.meta || "保存写真"; 
        entry.appendChild(img); 
        entry.appendChild(meta); 
        cameraGallery.appendChild(entry); // 読み込み時は末尾に追加 (prependだと逆順になる)
      }); 
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
    if(isBpmMeasuringOnCamera) return; // BPM測定画面ではこのフラグは使わないが念のため
    
    let bpmMeasurementHistory = []; // BPM測定画面用のローカル履歴
    bpmStatus.textContent = T.bpmMeasuring(8); // 開始表示
    let countdown = 7;
    const timerId = setInterval(() => {
      if (countdown <= 0) {
        clearInterval(timerId);
        // BPM計算ロジック（BPM測定画面用）
        const calculatedBpm = calcBpmFromMeasurementHistory(bpmMeasurementHistory);
        globalBpm = (calculatedBpm >= BPM_MIN && calculatedBpm <= BPM_MAX) ? calculatedBpm : 0;
        bpmStatus.textContent = globalBpm > 0 ? T.bpmResult(globalBpm) : T.bpmNotDetected;
        goToCameraScreenFromBPM(globalBpm);
      } else {
        bpmStatus.textContent = T.bpmMeasuring(countdown);
        countdown--;
      }
    }, 1000);

    // BPM測定中のデータ収集（BPM測定画面）
    const collectBpmData = () => {
      if (!bpmVideo.srcObject) return;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bpmVideo.videoWidth;
      tempCanvas.height = bpmVideo.videoHeight;
      const tempCtx = tempCanvas.getContext('2d');
      
      tempCtx.drawImage(bpmVideo, 0, 0, tempCanvas.width, tempCanvas.height);
      const size = 100;
      const x = (tempCanvas.width - size) / 2;
      const y = (tempCanvas.height - size) / 2;
      const imgData = tempCtx.getImageData(x, y, size, size);
      let sum = 0;
      for(let i=0; i<imgData.data.length; i+=4) {
        sum += (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
      }
      const avg = sum / (imgData.data.length/4);
      bpmMeasurementHistory.push({v: avg, t: Date.now()});
      if(bpmMeasurementHistory.length > 512) bpmMeasurementHistory.shift();
      
      if (countdown > 0) { // カウントダウン中のみ継続
        requestAnimationFrame(collectBpmData);
      }
    };
    requestAnimationFrame(collectBpmData);
  });

  // BPM測定画面でのBPM計算ロジック（カメラ画面のcalcBpmOnCameraとほぼ同じだが、履歴は別）
  function calcBpmFromMeasurementHistory(historyArray) { 
    if (historyArray.length < 30) return 0; 
    const vals = historyArray.map(o => o.v); 
    const times = historyArray.map(o => o.t); 
    const mean = vals.reduce((a,b) => a + b) / vals.length; 
    const cen = vals.map(v => v - mean); 
    const n = cen.length; 
    const re = new Array(n).fill(0), im = new Array(n).fill(0); 
    for (let k=0; k<n; k++) { 
      for (let t=0; t<n; t++) { 
        const ang = (2 * Math.PI * t * k) / n; 
        re[k] += cen[t] * Math.cos(ang); 
        im[k] -= cen[t] * Math.sin(ang); 
      } 
    } 
    const power = re.map((r,i) => Math.hypot(r, im[i])); 
    const dur = (times[times.length-1] - times[0]) / 1000; 
    if (dur < 5) return 0; 
    const freqRes = 1 / dur; 
    const peaks = power.map((p,i) => ({bpm: i * freqRes * 60, power: p})).filter(o => o.bpm >= BPM_MIN && o.bpm <= BPM_MAX); 
    if (!peaks.length) return 0; 
    return Math.round(peaks.reduce((a,b) => a.power > b.power ? a : b).bpm); 
  }


  // BPMスキップボタン
  bpmSkipBtn?.addEventListener('click', () => goToCameraScreenFromBPM(0)); // 0BPMでカメラ画面へ


  // ★ 撮影画面のイベントリスナー (ピンチイン、シャッター、アルバム、カメラ切替)

  // ピンチジェスチャーのpreventDefaultはapp-containerでまとめて処理
  cameraVideo.addEventListener("touchstart", (e) => { 
    if(e.touches.length === 2){ 
      lastCameraPinchDistance = Math.hypot( e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY ); 
    } 
  }, { passive: false });
  cameraVideo.addEventListener("touchmove", (e) => { 
    if(e.touches.length === 2){ 
      e.preventDefault(); // これがF値円のピンチ操作にのみ適用されるべき
      const d = Math.hypot( e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY ); 
      cameraScale += (d - lastCameraPinchDistance) * 0.005; // ピンチの動きに合わせてスケールを調整
      lastCameraPinchDistance = d; 
      cameraScale = Math.min(Math.max(cameraScale, MIN_CAMERA_SCALE), MAX_CAMERA_SCALE); // 範囲を制限
      updateCameraFValueDisplay(); // UIとF値フィルターを更新
      updateCameraCircleSize(); // 円のサイズも更新
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
             if(error.code === 1) {
                alert("位置情報の許可がありません。ブラウザや端末の設定を確認してください。");
             }
        }
        
        const captureCanvas = document.createElement("canvas"); // 撮影用の一時キャンバス
        captureCanvas.width = cameraVideo.videoWidth;
        captureCanvas.height = cameraVideo.videoHeight;
        const capCtx = captureCanvas.getContext("2d");

        if (currentCameraFacingMode === 'user') {
            capCtx.translate(captureCanvas.width, 0);
            capCtx.scale(-1, 1);
        }
        
        capCtx.filter = computeCssFilter(globalFValue); // グローバルF値を適用
        await captureWithMotionBlur(capCtx, cameraVideo, globalBpm, captureCanvas.width, captureCanvas.height); // グローバルBPMを適用
        
        let imageUrl = captureCanvas.toDataURL("image/jpeg", 0.9);

        if (position && window.piexif) {
            try {
                const now = new Date();
                const zeroth = {};
                const exif = {};
                const gps = {};

                const dateStr = `${now.getFullYear()}:${(now.getMonth()+1).toString().padStart(2,'0')}:${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
                zeroth[piexif.ImageIFD.Software] = "ココロカメラ";
                zeroth[piexif.ImageIFD.DateTime] = dateStr;
                exif[piexif.ExifIFD.DateTimeOriginal] = dateStr;
                exif[piexif.ExifIFD.DateTimeDigitized] = dateStr;
                exif[piexif.ExifIFD.UserComment] = piexif.tools.asciiToBytes(`F:${globalFValue},BPM:${globalBpm}`);

                const gpsDate = new Date(position.timestamp);
                gps[piexif.GPSIFD.GPSDateStamp] = `${gpsDate.getUTCFullYear()}:${(gpsDate.getUTCMonth()+1).toString().padStart(2,'0')}:${gpsDate.getUTCDate().toString().padStart(2,'0')}`;
                gps[piexif.GPSIFD.GPSTimeStamp] = [gpsDate.getUTCHours(), gpsDate.getUTCMinutes(), gpsDate.getUTCSeconds()];
                gps[piexif.GPSIFD.GPSLatitudeRef] = position.coords.latitude < 0 ? 'S' : 'N';
                gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDms(position.coords.latitude);
                gps[piexif.GPSIFD.GPSLongitudeRef] = position.coords.longitude < 0 ? 'W' : 'E';
                gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDms(position.coords.longitude);
                
                const exifObj = {"0th":zeroth, "Exif":exif, "GPS":gps};
                const exifBytes = piexif.dump(exifObj);
                imageUrl = piexif.insert(exifBytes, imageUrl);
            } catch (exifError) {
                console.error("EXIF埋め込み失敗:", exifError);
            }
        }

        const metaBPM = (globalBpm >= BPM_MIN && globalBpm <= BPM_MAX) ? `${globalBpm} BPM` : "--- BPM";
        const metaText = `F${globalFValue}\n${metaBPM}\n${locationString}\n${new Date().toLocaleString('ja-JP')}`;
        
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
    await startCameraScreen(currentCameraFacingMode, globalFValue, globalBpm); // F値とBPMは維持
  };

  // 撮影画面でのBPM測定ボタン
  cameraStartBpmButton.onclick = () => {
    if(isBpmMeasuringOnCamera) return;
    isBpmMeasuringOnCamera = true;
    cameraBpmHistory = [];
    cameraBpmValueDisplay.textContent = "測定中...";
    cameraStartBpmButton.classList.add('disabled'); // 測定中はボタンを無効化

    setTimeout(() => {
      isBpmMeasuringOnCamera = false;
      const newBpm = calcBpmOnCamera();
      globalBpm = (newBpm >= BPM_MIN && newBpm <= BPM_MAX) ? newBpm : 0;
      cameraBpmValueDisplay.textContent = globalBpm > 0 ? globalBpm : "---";
      cameraStartBpmButton.classList.remove('disabled'); // 測定終了後、ボタンを有効化
    }, 8000); // 8秒間測定
  };


  // ====== 初期化 ======
  const T = { appTitle: "ココロカメラ", splashTagline: "あなたの心のシャッターを切る", start: "はじめる", howtoTitle: "名前とルームコードの入力", howtoText: "あなたの名前（ニックネーム）とルームコードを<br>入力してください。（任意）", fInputTitle: "今の心の状態に合わせて<br>円を広げたり縮めたりしてください", fHint1: "F値が小さいほど「開放的」に、", fHint2: "F値が大きいほど「集中している」状態を表します。", decide: "決定", bpmTitle: "ココロのシャッタースピード", bpmPrep_html: 'カメラに<strong>指先を軽く当てて</strong>ください<br>赤みの変化から心拍数を測定します', bpmReady: "準備ができたら計測開始を押してください", bpmStart: "計測開始", skip: "スキップ", switchCam: "切り替え", shoot: "撮影", info: "アルバム", bpmMeasuring: (remain) => `計測中… 残り ${remain} 秒`, bpmResult: (bpm) => `推定BPM: ${bpm}`, bpmNotDetected: "測定できませんでした", cameraError: "カメラを起動できませんでした。"};
  function applyTexts(dict) { document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach(el => { const key = el.dataset.i18n || el.dataset.i18nHtml; if (dict[key]) { if (el.dataset.i18n) el.textContent = dict[key]; else el.innerHTML = dict[key]; } }); }
  applyTexts(T);

  // アプリ起動時にアルバムを読み込む
  loadAlbumFromLocalStorage();
  
  // 初期画面を表示
  showScreen('initial');
});

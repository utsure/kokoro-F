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
    const fValueDisplaySetup = document.getElementById('f-value-display-setup');
    const fValueDecideBtn = document.getElementById('f-value-decide-btn');

    // BPM測定画面用の要素
    const bpmVideo = document.getElementById('bpm-video');
    const bpmStartBtn = document.getElementById('bpm-start-btn');
    const bpmSkipBtn = document.getElementById('bpm-skip-btn');
    const bpmStatus = document.getElementById('bpm-status');

    // ★ カメラ撮影画面用の要素 ★
    const cameraVideo = document.getElementById("camera-video");
    const cameraCanvas = document.getElementById("camera-canvas");
    const cameraCtx = cameraCanvas.getContext("2d", { willReadFrequently: true });
    const cameraBpmValueDisplay = document.getElementById("camera-bpm-value");
    const cameraFValueDisplay = document.getElementById("camera-f-value");
    const cameraCenterCircle = document.getElementById("center-circle");
    const cameraShutterButton = document.getElementById("shutter-button");
    const cameraSwitchButton = document.getElementById("switch-camera-button");
    const cameraAlbumButton = document.getElementById("album-button");
    const cameraGallery = document.getElementById("gallery");
    const cameraStartBpmButton = document.getElementById("start-bpm-button");

    const graphCanvas = document.getElementById("graph");
    const graphCtx = graphCanvas.getContext("2d");


    // アプリケーション共通の変数
    let globalFValue = 22;
    let globalBpm = 0;

    let currentCameraStream = null;
    let currentCameraFacingMode = 'environment'; // 'environment' or 'user'

    // F値の範囲
    const MIN_F_APP = 2.0;
    const MAX_F_APP = 22.0;

    // F値入力画面のピンチ操作用の変数
    let fInputPinchInitialDistance = 0;
    let fInputCurrentRadius = 0;
    // CSSでvw単位を使用するため、ここではpxの最小最大値の代わりに比率を調整する基準値を設定
    const MIN_CIRCLE_SIZE_RATIO = 0.2; // 例: 画面幅の20%
    const MAX_CIRCLE_SIZE_RATIO = 0.6; // 例: 画面幅の60%


    // 撮影画面のF値ピンチ操作用の変数
    let cameraScale = 0.25; // F値のスケール (0.25-4.0)
    const MIN_CAMERA_SCALE = 0.25;
    const MAX_CAMERA_SCALE = 4.0;
    let lastCameraPinchDistance = 0;

    // BPM測定の変数
    let isBpmMeasuringOnCamera = false;
    let cameraBpmHistory = [];
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
        if (bpmVideo.srcObject) {
            bpmVideo.srcObject.getTracks().forEach(t => t.stop());
            bpmVideo.srcObject = null;
        }
        if (currentCameraStream) {
            currentCameraStream.getTracks().forEach(track => track.stop());
            currentCameraStream = null;
        }
        if (cameraLoopId) {
            cancelAnimationFrame(cameraLoopId);
            cameraLoopId = null;
        }
    }

    // ====== F値入力画面 ======
    // F値から円のサイズ（画面幅に対する比率）を計算
    const fToCircleSizeRatio = f => {
        const ratio = MIN_CIRCLE_SIZE_RATIO + ((MAX_F_APP - f) / (MAX_F_APP - MIN_F_APP)) * (MAX_CIRCLE_SIZE_RATIO - MIN_CIRCLE_SIZE_RATIO);
        return Math.max(MIN_CIRCLE_SIZE_RATIO, Math.min(MAX_CIRCLE_SIZE_RATIO, ratio));
    };
    
    function updateApertureUI(f) {
        const cF = Math.max(MIN_F_APP, Math.min(MAX_F_APP, f));
        const sizeRatio = fToCircleSizeRatio(cF);
        // vw単位でサイズを設定
        apertureControl.style.width = `${sizeRatio * 100}vw`;
        apertureControl.style.height = `${sizeRatio * 100}vw`;
        apertureControl.style.maxWidth = `${sizeRatio * 450}px`; // max-widthも追従
        apertureControl.style.maxHeight = `${sizeRatio * 450}px`; // max-heightも追従
        
        fValueDisplaySetup.textContent = cF.toFixed(1);
        globalFValue = cF; // アプリ全体で使うF値を更新
    }
    updateApertureUI(globalFValue); // 初期表示

    // F値設定画面のピンチジェスチャー
    apertureControl.addEventListener("touchstart", (e) => {
        e.preventDefault(); // 画面全体のスクロールや拡大を防止
        if (e.touches.length === 2) {
            fInputPinchInitialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            // 現在のサイズをvwからpxに変換して取得
            fInputCurrentRadius = apertureControl.offsetWidth;
        }
    }, { passive: false });

    apertureControl.addEventListener("touchmove", (e) => {
        e.preventDefault();
        if (e.touches.length === 2) {
            const currentPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const scaleFactor = currentPinchDistance / fInputPinchInitialDistance;
            
            let newSizePx = fInputCurrentRadius * scaleFactor;
            
            // newSizePxを画面幅に対する比率に変換
            const currentScreenWidth = document.querySelector('.app-container').offsetWidth;
            let newSizeRatio = newSizePx / currentScreenWidth;

            newSizeRatio = Math.max(MIN_CIRCLE_SIZE_RATIO, Math.min(MAX_CIRCLE_SIZE_RATIO, newSizeRatio));

            // 新しい比率からF値を逆算
            let newFValue = MAX_F_APP - ((newSizeRatio - MIN_CIRCLE_SIZE_RATIO) / (MAX_CIRCLE_SIZE_RATIO - MIN_CIRCLE_SIZE_RATIO)) * (MAX_F_APP - MIN_F_APP);
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
            goToCameraScreenFromBPM(0);
        }
    }

    async function goToCameraScreenFromBPM(bpmValue) {
        globalBpm = bpmValue > 0 ? bpmValue : 0;
        showScreen('camera');
    }


    // ====== ★ 撮影画面のロジック ★ ======
    let cameraLoopId = null;

    function computeCssFilter(apValue) { 
        const blurPx = Math.max(0, (22 - apValue) / 20 * 10); 
        const brightness = 2.0 - (apValue / 22); 
        return `blur(${blurPx.toFixed(1)}px) brightness(${brightness.toFixed(2)})`; 
    }

    // 円のサイズを更新 (vw単位で更新)
    function updateCameraCircleSize() { 
        const ratio = (150 * cameraScale) / document.querySelector('.app-container').offsetWidth; // 150pxは基準値
        cameraCenterCircle.style.width = `${ratio * 100}vw`; 
        cameraCenterCircle.style.height = `${ratio * 100}vw`; 
    }
    
    function updateCameraFValueDisplay() { 
        globalFValue = Math.round((cameraScale - MIN_CAMERA_SCALE) / (MAX_CAMERA_SCALE - MIN_CAMERA_SCALE) * (MIN_F_APP - MAX_F_APP) + MAX_F_APP); 
        globalFValue = Math.max(MIN_F_APP, Math.min(MAX_F_APP, globalFValue));
        cameraCenterCircle.textContent = globalFValue; 
        cameraFValueDisplay.textContent = globalFValue; 
        cameraVideo.style.filter = computeCssFilter(globalFValue);
    }


    async function startCameraScreen(facingMode, initialFValue, initialBpm) {
        globalFValue = initialFValue;
        globalBpm = initialBpm;

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
            
            resizeCameraCanvas();
            
            updateCameraFValueDisplay();
            updateCameraCircleSize();
            cameraBpmValueDisplay.textContent = globalBpm > 0 ? globalBpm : "---";
            
            startCameraLoop();
        } catch (e) {
            console.error("カメラの起動に失敗しました:", e);
            alert("カメラの起動に失敗しました。");
            showScreen('bpm');
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


    function startCameraLoop() {
        if (cameraLoopId) cancelAnimationFrame(cameraLoopId);
        const loop = () => {
            if (cameraVideo.readyState >= 2) {
                cameraVideo.style.filter = computeCssFilter(globalFValue);
                cameraVideo.style.transform = (currentCameraFacingMode === 'user') ? 'scaleX(-1)' : 'none';

                cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
                if (isBpmMeasuringOnCamera) {
                    cameraCtx.filter = 'none';
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
                drawBpmGraphOnCamera();
            }
            cameraLoopId = requestAnimationFrame(loop);
        };
        cameraLoopId = requestAnimationFrame(loop);
    }

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
        tc.globalCompositeOperation = 'source-over';
    }

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
                cameraGallery.appendChild(entry);
            }); 
        } 
    }


    // ====== イベントリスナー設定 ======
    document.getElementById('initial-next-btn')?.addEventListener('click', () => showScreen('fvalue'));

    fValueDecideBtn?.addEventListener('click', () => {
        showScreen('bpm');
    });

    bpmStartBtn?.addEventListener('click', () => {
        if(isBpmMeasuringOnCamera) return;
        
        let bpmMeasurementHistory = [];
        bpmStatus.textContent = T.bpmMeasuring(8);
        let countdown = 7;
        const timerId = setInterval(() => {
            if (countdown <= 0) {
                clearInterval(timerId);
                const calculatedBpm = calcBpmFromMeasurementHistory(bpmMeasurementHistory);
                globalBpm = (calculatedBpm >= BPM_MIN && calculatedBpm <= BPM_MAX) ? calculatedBpm : 0;
                bpmStatus.textContent = globalBpm > 0 ? T.bpmResult(globalBpm) : T.bpmNotDetected;
                goToCameraScreenFromBPM(globalBpm);
            } else {
                bpmStatus.textContent = T.bpmMeasuring(countdown);
                countdown--;
            }
        }, 1000);

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
            
            if (countdown > 0) {
                requestAnimationFrame(collectBpmData);
            }
        };
        requestAnimationFrame(collectBpmData);
    });

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

    bpmSkipBtn?.addEventListener('click', () => goToCameraScreenFromBPM(0));

    // ★ 撮影画面のF値ピンチ操作 ★
    cameraCenterCircle.addEventListener("touchstart", (e) => { 
        e.preventDefault(); // これが最重要。この要素上でのピンチズームを阻止
        if(e.touches.length === 2){ 
            lastCameraPinchDistance = Math.hypot( e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY ); 
            cameraCenterCircle.classList.add('active-pinch'); // ピンチ中であることを示すクラスを追加
        } 
    }, { passive: false });
    cameraCenterCircle.addEventListener("touchmove", (e) => { 
        e.preventDefault(); // ここでも阻止
        if(e.touches.length === 2){ 
            const d = Math.hypot( e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY ); 
            // スケール変更量を調整
            cameraScale += (d - lastCameraPinchDistance) * 0.005; 
            lastCameraPinchDistance = d; 
            cameraScale = Math.min(Math.max(cameraScale, MIN_CAMERA_SCALE), MAX_CAMERA_SCALE);
            updateCameraFValueDisplay();
            updateCameraCircleSize();
        } 
    }, { passive: false });
    cameraCenterCircle.addEventListener("touchend", (e) => {
        cameraCenterCircle.classList.remove('active-pinch'); // ピンチ終了クラスを削除
    });


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
            
            const captureCanvas = document.createElement("canvas");
            captureCanvas.width = cameraVideo.videoWidth;
            captureCanvas.height = cameraVideo.videoHeight;
            const capCtx = captureCanvas.getContext("2d");

            if (currentCameraFacingMode === 'user') {
                capCtx.translate(captureCanvas.width, 0);
                capCtx.scale(-1, 1);
            }
            
            capCtx.filter = computeCssFilter(globalFValue);
            await captureWithMotionBlur(capCtx, cameraVideo, globalBpm, captureCanvas.width, captureCanvas.height);
            
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
        await startCameraScreen(currentCameraFacingMode, globalFValue, globalBpm);
    };

    cameraStartBpmButton.onclick = () => {
        if(isBpmMeasuringOnCamera) return;
        isBpmMeasuringOnCamera = true;
        cameraBpmHistory = [];
        cameraBpmValueDisplay.textContent = "測定中...";
        cameraStartBpmButton.classList.add('disabled');

        setTimeout(() => {
            isBpmMeasuringOnCamera = false;
            const newBpm = calcBpmOnCamera();
            globalBpm = (newBpm >= BPM_MIN && newBpm <= BPM_MAX) ? newBpm : 0;
            cameraBpmValueDisplay.textContent = globalBpm > 0 ? globalBpm : "---";
            cameraStartBpmButton.classList.remove('disabled');
        }, 8000);
    };


    // ====== 初期化 ======
    const T = { appTitle: "ココロカメラ", splashTagline: "あなたの心のシャッターを切る", start: "はじめる", howtoTitle: "名前とルームコードの入力", howtoText: "あなたの名前（ニックネーム）とルームコードを<br>入力してください。（任意）", fInputTitle: "今の心の状態に合わせて<br>円を広げたり縮めたりしてください", fHint1: "F値が小さいほど「開放的」に、", fHint2: "F値が大きいほど「集中している」状態を表します。", decide: "決定", bpmTitle: "ココロのシャッタースピード", bpmPrep_html: 'カメラに<strong>指先を軽く当てて</strong>ください<br>赤みの変化から心拍数を測定します', bpmReady: "準備ができたら計測開始を押してください", bpmStart: "計測開始", skip: "スキップ", switchCam: "切り替え", shoot: "撮影", info: "アルバム", bpmMeasuring: (remain) => `計測中… 残り ${remain} 秒`, bpmResult: (bpm) => `推定BPM: ${bpm}`, bpmNotDetected: "測定できませんでした", cameraError: "カメラを起動できませんでした。"};
    function applyTexts(dict) { document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach(el => { const key = el.dataset.i18n || el.dataset.i18nHtml; if (dict[key]) { if (el.dataset.i18n) el.textContent = dict[key]; else el.innerHTML = dict[key]; } }); }
    applyTexts(T);

    loadAlbumFromLocalStorage();
    
    showScreen('initial');
});

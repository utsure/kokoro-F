(async () => {
    const video = document.getElementById("video");
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const bpmText = document.getElementById("bpm-value");
    const fText = document.getElementById("f-value");
    const graph = document.getElementById("graph");
    const gctx = graph.getContext("2d");
    const gallery = document.getElementById("gallery");
    const centerCircle = document.getElementById("center-circle");
    const shutterButton = document.getElementById("shutter-button");

    let measuring = false;
    let bpm = 0;
    let history = []; // BPM計測の履歴
    let scale = 0.25; // F値のスケール (0.25-4.0)
    let fValue = 22; // 表示F値 (2-22)
    let lastPinch = 0;
    let currentFacingMode = 'environment';
    let mediaStream;

    // F値とBPMの範囲
    const MIN_F_DISPLAY = 2;
    const MAX_F_DISPLAY = 22;
    const MIN_SCALE = 0.25;
    const MAX_SCALE = 4.0;
    const MIN_BPM = 60;
    const MAX_BPM = 100;

    // 意図しないズームを防止 (既存のまま)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.body.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });

    function resizeCanvas() {
        if (video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        // グラフキャンバスもリサイズ
        if (graph.parentElement) { // 親要素が存在することを確認
            graph.width = graph.parentElement.clientWidth;
            graph.height = graph.parentElement.clientHeight;
        }
    }

    async function startCamera(facingMode) {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: facingMode,
                    width: { ideal: 1280 }, // 高解像度で取得
                    height: { ideal: 720 }
                }
            });
            mediaStream = stream;
            video.srcObject = stream;
            await video.play();
            currentFacingMode = facingMode; // カメラの向きを更新
            resizeCanvas(); // カメラ起動後にキャンバスサイズを調整
        } catch (e) {
            alert(`カメラの起動に失敗しました: ${e.name}`);
            console.error(e);
        }
    }

    video.addEventListener('loadedmetadata', () => {
        resizeCanvas();
    });

    video.addEventListener('play', () => {
        resizeCanvas();
        // ユーザーカメラの場合は左右反転
        video.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'none';
        // F値フィルターを再適用
        video.style.filter = computeCssFilter(fValue);
    });

    // F値に応じて円のサイズと値を更新
    function updateCircleAndFValue() {
        const radius = 150 * scale;
        centerCircle.style.width = radius + "px";
        centerCircle.style.height = radius + "px";

        // スケール値(0.25-4.0)をF値(22-2)に変換
        fValue = Math.round((MAX_SCALE - scale) / (MAX_SCALE - MIN_SCALE) * (MAX_F_DISPLAY - MIN_F_DISPLAY) + MIN_F_DISPLAY);
        fValue = Math.max(MIN_F_DISPLAY, Math.min(MAX_F_DISPLAY, fValue)); // 範囲を保証

        centerCircle.textContent = fValue;
        fText.textContent = fValue;
        video.style.filter = computeCssFilter(fValue); // ★ リアルタイムでF値フィルターを適用
    }

    // F値からCSSフィルター文字列を生成
    function computeCssFilter(apValue) {
        // F値が小さいほどボケて明るく、大きいほどシャープで暗く
        const blurPx = Math.max(0, (MAX_F_DISPLAY - apValue) / (MAX_F_DISPLAY - MIN_F_DISPLAY) * 15); // F2で15px, F22で0px
        const brightness = 0.8 + (MAX_F_DISPLAY - apValue) / (MAX_F_DISPLAY - MIN_F_DISPLAY) * 0.7; // F2で1.5, F22で0.8
        return `blur(${blurPx.toFixed(1)}px) brightness(${brightness.toFixed(2)})`;
    }

    // グラフ描画
    function drawGraph() {
        if (history.length === 0) return;

        const arr = history.slice(-graph.width).map(o => o.v); // グラフ幅に合わせたデータ
        if (arr.length < 2) { // データが少なすぎる場合は描画しない
            gctx.clearRect(0, 0, graph.width, graph.height);
            return;
        }

        const min = Math.min(...arr);
        const max = Math.max(...arr);
        gctx.clearRect(0, 0, graph.width, graph.height);
        gctx.beginPath();
        arr.forEach((v, i) => {
            const x = (i / arr.length) * graph.width;
            const y = graph.height - ((v - min) / (max - min + 1e-6)) * graph.height; // +1e-6でゼロ除算回避
            i === 0 ? gctx.moveTo(x, y) : gctx.lineTo(x, y);
        });
        gctx.strokeStyle = "#0f8";
        gctx.lineWidth = 1.5;
        gctx.stroke();
    }

    // BPM計算
    function calcBPM() {
        if (history.length < 30) return 0; // 最低限のデータ量
        
        // 過去数秒間のデータに限定して計算
        const relevantHistory = history.filter(o => (Date.now() - o.t) < 8000); // 直近8秒間のデータ
        if (relevantHistory.length < 30) return 0;

        const vals = relevantHistory.map(o => o.v);
        const times = relevantHistory.map(o => o.t);

        // 高速フーリエ変換 (FFT) を使用して周波数解析
        // この部分は、より高度なFFTライブラリを使用するのが理想ですが、ここでは簡易的な実装を継続
        const n = vals.length;
        if (n === 0) return 0;

        const mean = vals.reduce((a, b) => a + b) / n;
        const detrended = vals.map(v => v - mean);

        const real = new Array(n).fill(0);
        const imag = new Array(n).fill(0);

        for (let k = 0; k < n; k++) { // 周波数ビン
            for (let t = 0; t < n; t++) { // 時間サンプル
                const angle = (2 * Math.PI * t * k) / n;
                real[k] += detrended[t] * Math.cos(angle);
                imag[k] -= detrended[t] * Math.sin(angle);
            }
        }

        const power = real.map((r, i) => Math.hypot(r, imag[i]));
        const duration = (times[times.length - 1] - times[0]) / 1000; // サンプル期間（秒）

        if (duration < 5) return 0; // 短すぎる期間では正確なBPMは計算できない

        const freqResolution = 1 / duration; // 周波数分解能 (Hz)
        
        let maxPower = 0;
        let dominantBpm = 0;

        for (let i = 0; i < n / 2; i++) { // ナイキスト周波数まで
            const currentBpm = i * freqResolution * 60; // BPMに変換

            if (currentBpm >= MIN_BPM && currentBpm <= MAX_BPM) {
                if (power[i] > maxPower) {
                    maxPower = power[i];
                    dominantBpm = currentBpm;
                }
            }
        }
        return Math.round(dominantBpm);
    }

    // メインループ
    function loop() {
        if (video.readyState >= 2) {
            // BPM計測中の処理
            if (measuring) {
                // video要素から直接データを取得し、赤み（平均輝度）を計算
                // キャンバスへの描画は行わない（フィルターが干渉しないように）
                ctx.clearRect(0, 0, canvas.width, canvas.height); // キャンバスはクリア
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // 一時的に描画
                
                const size = 100; // サンプリング領域
                const x = (canvas.width - size) / 2;
                const y = (canvas.height - size) / 2;
                const imgData = ctx.getImageData(x, y, size, size);
                
                let sum = 0;
                for(let i=0; i<imgData.data.length; i+=4) {
                    sum += (imgData.data[i] * 0.299 + imgData.data[i+1] * 0.587 + imgData.data[i+2] * 0.114); // 輝度計算
                }
                const avgLuminance = sum / (imgData.data.length/4);
                
                history.push({v: avgLuminance, t: Date.now()});
                if(history.length > 512) history.shift(); // 履歴を制限

                drawGraph(); // グラフ描画
            }
        }
        requestAnimationFrame(loop);
    }

    // BPM測定開始ボタン
    document.getElementById("start-bpm-button").onclick = () => {
        if(measuring) return; // 既に測定中の場合は何もしない

        measuring = true;
        history = []; // 履歴をリセット
        bpmText.textContent = "測定中...";
        
        // 8秒後に測定終了
        setTimeout(() => {
            measuring = false;
            const newBpm = calcBPM();
            bpm = (newBpm >= MIN_BPM && newBpm <= MAX_BPM) ? newBpm : 0; // 有効範囲内のBPMのみ採用
            bpmText.textContent = (bpm > 0) ? bpm : "---"; // 0の場合は---表示
        }, 8000); // 8秒間測定
    };

    // カメラ切り替えボタン
    document.getElementById('switch-camera-button').onclick = async () => {
        currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
        await startCamera(currentFacingMode);
    };

    // シャッターボタン
    shutterButton.onclick = async () => {
        if (shutterButton.classList.contains('disabled')) return;
        shutterButton.classList.add('disabled'); // 連打防止

        try {
            // 位置情報取得
            let position = null;
            let locationString = "位置情報なし";
            try {
                position = await getLocation();
                locationString = `Lat:${position.coords.latitude.toFixed(5)} Lon:${position.coords.longitude.toFixed(5)}`;
            } catch (error) {
                console.warn("位置情報取得エラー:", error.message);
                if(error.code === 1) {
                    // alert("位置情報の許可がありません。ブラウザや端末の設定を確認してください。");
                }
            }
            
            // 撮影用キャンバスに描画
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const capCtx = canvas.getContext("2d");

            // ユーザーカメラの場合は左右反転
            capCtx.save();
            if (currentFacingMode === 'user') {
                capCtx.translate(canvas.width, 0);
                capCtx.scale(-1, 1);
            }
            
            // F値フィルターを撮影用キャンバスに適用
            capCtx.filter = computeCssFilter(fValue);

            // BPMに応じたモーションブラーをかけながら描画
            await captureWithMotionBlur(capCtx, video, bpm, canvas.width, canvas.height);
            
            capCtx.restore(); // 反転を元に戻す

            let imageUrl = canvas.toDataURL("image/jpeg", 0.9);

            // EXIF情報埋め込み
            if (position && window.piexif) {
                try {
                    const now = new Date();
                    const dateStr = `${now.getFullYear()}:${(now.getMonth()+1).toString().padStart(2,'0')}:${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
                    
                    const exifObj = {
                        "0th": {
                            [piexif.ImageIFD.Software]: "ココロカメラ",
                            [piexif.ImageIFD.DateTime]: dateStr,
                        },
                        "Exif": {
                            [piexif.ExifIFD.DateTimeOriginal]: dateStr,
                            [piexif.ExifIFD.DateTimeDigitized]: dateStr,
                            // F値とBPMをカスタムExifタグとして追加することも可能 (対応するタグがあれば)
                            // あるいは、UserCommentとして文字列で埋め込む
                            [piexif.ExifIFD.UserComment]: piexif.tools.asciiToBytes(`F:${fValue},BPM:${bpm}`)
                        },
                        "GPS": {
                            [piexif.GPSIFD.GPSDateStamp]: `${now.getUTCFullYear()}:${(now.getUTCMonth()+1).toString().padStart(2,'0')}:${now.getUTCDate().toString().padStart(2,'0')}`,
                            [piexif.GPSIFD.GPSTimeStamp]: [now.getUTCHours(),

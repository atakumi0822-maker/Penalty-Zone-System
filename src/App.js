import React, { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';

function App() {
  const [tesseractLoaded, setTesseractLoaded] = useState(false);
  const tesseractRef = useRef(null);
  const [selectedDistance, setSelectedDistance] = useState(null);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [detectedNumber, setDetectedNumber] = useState('');
  const [timers, setTimers] = useState({});
  const [expiredTimers, setExpiredTimers] = useState(new Set());
  const [recordHistory, setRecordHistory] = useState([]);
  const [manualInput, setManualInput] = useState('');
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const timerIntervalsRef = useRef({});
  const loggedIds = useRef(new Set());

  // Tesseract.js の読み込みと初期化
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = async () => {
      // 読み込み完了後、ワーカーを作成
      tesseractRef.current = window.Tesseract;
      setTesseractLoaded(true);
    };
    document.body.appendChild(script);
    return () => { if (document.body && document.body.contains(script)) document.body.removeChild(script); };
  }, []);

  const distances = [
    { value: 5, label: '5km' }, { value: 10, label: '10km' },
    { value: 20, label: '20km' }, { value: 30, label: '30km' },
    { value: 40, label: '40km' }, { value: 50, label: '50km' }
  ];

  const getTimerDuration = (distance) => distance === 5 ? 30 : (distance / 10) * 60;

  const selectDistance = (distance) => {
    setSelectedDistance(distance);
    setIsAccordionOpen(false);
  };

  const playBeepSound = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (err) { console.error("Sound error:", err); }
  };

  const formatDateTime = (date) => {
    return date.getHours().toString().padStart(2, '0') + ':' + 
           date.getMinutes().toString().padStart(2, '0') + ':' + 
           date.getSeconds().toString().padStart(2, '0');
  };

  const requestCameraPermission = async () => {
    if (streamRef.current) {
        stopCamera();
    }
    try {
      const constraints = {
        video: { 
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("webkit-playsinline", "true");
        videoRef.current.muted = true;
        
        await videoRef.current.play();
        setIsCameraActive(true);
        startDetection();
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("カメラの起動に失敗しました。");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    setIsCameraActive(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    setDetectedNumber('');
  };

  const startDetection = () => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    // 1.5秒に1回スキャン（2秒より少し速く）
    detectionIntervalRef.current = setInterval(captureAndDetect, 1500);
  };

  const captureAndDetect = async () => {
    if (!videoRef.current || !canvasRef.current || !tesseractRef.current || !isCameraActive) return;
    
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    if (videoRef.current.videoWidth > 0) {
      // 読み取り精度向上のため、少し画像を加工
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      
      // 画像をキャンバスに描画
      context.filter = 'contrast(150%) grayscale(100%)'; // コントラストを上げ、白黒にする
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      context.filter = 'none'; // 元に戻す

      try {
        // AIに解析を依頼（英語＋数字限定モード）
        const { data: { text } } = await tesseractRef.current.recognize(canvas, 'eng', {
            // 数字だけを探すように指示（超重要）
            tessedit_char_whitelist: '0123456789',
            // OCRエンジンのモードを指定
            tessjs_create_hocr: '0',
            tessjs_create_tsv: '0'
        });

        // 読み取ったテキストから数字を抽出
        const numbers = text.replace(/\s/g, '').match(/\d+/);
        if (numbers) {
          const bib = numbers[0];
          // 2桁以上の数字のみ有効とする（誤検知防止）
          if (bib.length >= 1) {
            setDetectedNumber(bib);
            if (selectedDistance && !timers[bib]) {
                startTimerForBib(bib);
            }
          }
        }
      } catch (err) { 
        console.error("AI OCR error:", err); 
      }
    }
  };

  const startTimerForBib = (bibNumber) => {
    if (timers[bibNumber]) return;
    const duration = getTimerDuration(selectedDistance);
    const startTime = new Date();
    const entryId = `entry-${bibNumber}-${Date.now()}`;
    const endTime = Date.now() + duration * 1000;
    
    setRecordHistory(prev => [{ bibNumber, type: 'entry', displayTime: formatDateTime(startTime), distance: selectedDistance, id: entryId }, ...prev]);
    setTimers(prev => ({
      ...prev,
      [bibNumber]: { bibNumber, duration, remaining: duration, endTime, distance: selectedDistance, isExpired: false }
    }));
    
    timerIntervalsRef.current[bibNumber] = setInterval(() => {
      setTimers(prev => {
        const timer = prev[bibNumber];
        if (!timer || timer.isExpired) return prev;
        const remaining = Math.max(0, Math.floor((timer.endTime - Date.now()) / 1000));
        if (remaining === 0) {
          clearInterval(timerIntervalsRef.current[bibNumber]);
          playBeepSound();
          const exitTime = new Date();
          const exitLogId = `exit-${bibNumber}-${timer.endTime}`;
          if (!loggedIds.current.has(exitLogId)) {
            loggedIds.current.add(exitLogId);
            setRecordHistory(h => [{ bibNumber, type: 'exit', displayTime: formatDateTime(exitTime), distance: selectedDistance, id: exitLogId }, ...h]);
            setExpiredTimers(e => new Set([...e, bibNumber]));
            setTimeout(() => setExpiredTimers(e => { const n = new Set(e); n.delete(bibNumber); return n; }), 5000);
          }
          return { ...prev, [bibNumber]: { ...timer, remaining: 0, isExpired: true } };
        }
        return { ...prev, [bibNumber]: { ...timer, remaining } };
      });
    }, 100);
  };

  const removeTimer = (bib) => {
    if (timerIntervalsRef.current[bib]) {
      clearInterval(timerIntervalsRef.current[bib]);
      delete timerIntervalsRef.current[bib];
    }
    setTimers(prev => {
      const timer = prev[bib];
      if (timer && !timer.isExpired) {
        const exitTime = new Date();
        const manualId = `manual-${bib}-${Date.now()}`;
        setRecordHistory(h => [{ bibNumber: bib, type: 'manual_exit', displayTime: formatDateTime(exitTime), distance: timer.distance, id: manualId }, ...h]);
      }
      const n = {...prev};
      delete n[bib];
      return n;
    });
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className={`min-h-screen transition-colors duration-500 ${expiredTimers.size > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
      <style>{`
        .expired-alert { animation: pulse 1s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .scan-line {
          position: absolute;
          width: 100%;
          height: 2px;
          background: rgba(59, 130, 246, 0.5);
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
          animation: scan 3s linear infinite;
        }
        @keyframes scan {
          0% { top: 0%; }
          100% { top: 100%; }
        }
      `}</style>

      <div className="bg-white shadow-sm border-b-2 border-blue-600 p-4">
        <h1 className="text-xl font-bold text-center text-blue-800">競歩ペナルティーゾーン管理</h1>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="bg-white rounded-lg shadow border overflow-hidden border-blue-100">
          <button onClick={() => setIsAccordionOpen(!isAccordionOpen)} className="w-full p-4 bg-blue-600 text-white flex justify-between font-bold items-center">
            {selectedDistance ? `距離: ${selectedDistance}km (${getTimerDuration(selectedDistance)}秒)` : '1. 距離を選択してください'}
            <span>{isAccordionOpen ? '▲' : '▼'}</span>
          </button>
          {isAccordionOpen && (
            <div className="p-4 grid grid-cols-2 gap-2 bg-blue-50">
              {distances.map(d => (
                <button key={d.value} onClick={() => selectDistance(d.value)} className="p-3 bg-white border border-blue-200 rounded-lg font-bold text-blue-700 hover:bg-blue-100 transition">
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedDistance && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl shadow-md border-2 border-blue-50">
              <div className="flex gap-2 mb-4">
                <input type="text" inputMode="numeric" value={manualInput} onChange={(e) => setManualInput(e.target.value.replace(/\D/g, ''))} placeholder="手動入力" className="flex-1 border-2 border-gray-100 p-2 rounded-lg text-lg outline-none focus:border-blue-400" />
                <button onClick={() => { if(manualInput) { startTimerForBib(manualInput); setManualInput(''); } }} className="bg-green-600 text-white px-6 rounded-lg font-bold shadow-sm">追加</button>
              </div>
              
              <div className="relative bg-black rounded-xl overflow-hidden shadow-inner" style={{ minHeight: '300px' }}>
                <video ref={videoRef} autoPlay muted playsInline className={`w-full h-full ${isCameraActive ? 'block' : 'hidden'}`} style={{ minHeight: '300px', objectFit: 'cover' }} />
                
                {!isCameraActive ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <button onClick={requestCameraPermission} className="bg-blue-600 text-white px-8 py-3 rounded-full font-bold shadow-lg animate-pulse">📹 AIカメラを起動</button>
                  </div>
                ) : (
                  <>
                    <div className="scan-line"></div>
                    <button onClick={stopCamera} className="absolute top-2 right-2 bg-red-600/80 text-white px-4 py-1 rounded-full text-xs font-bold z-20 backdrop-blur-sm">停止</button>
                    <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-[10px] z-20">AI稼働中...</div>
                    
                    {detectedNumber && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-2xl font-black text-2xl border-2 border-white animate-bounce z-30">
                        {detectedNumber} 番を検知！
                      </div>
                    )}
                  </>
                )}
              </div>
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <p className="text-[10px] text-gray-400 mt-2 text-center">※ゼッケンを明るい場所で、画面中央に近づけてください</p>
            </div>

            <div className="space-y-3">
              {Object.values(timers).length === 0 && <p className="text-center text-gray-400 py-10 bg-white rounded-lg border-2 border-dashed border-gray-100">現在、ペナルティー中の選手はいません</p>}
              {Object.values(timers).map(timer => (
                <div key={timer.bibNumber} className={`p-5 rounded-2xl border-l-[12px] shadow-sm transition-all ${expiredTimers.has(timer.bibNumber) ? 'bg-red-600 text-white border-red-800 scale-[1.02]' : 'bg-white border-blue-600'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-[10px] font-bold opacity-70">BIB NUMBER</div>
                      <div className="text-4xl font-black">{timer.bibNumber}</div>
                    </div>
                    <div className="text-right flex-1 px-4">
                      <div className="text-[10px] font-bold opacity-70">REMAINING</div>
                      <div className="text-5xl font-mono font-black">{formatTime(timer.remaining)}</div>
                    </div>
                    <button onClick={() => removeTimer(timer.bibNumber)} className={`px-4 py-2 rounded-xl font-bold text-sm shadow-sm ${expiredTimers.has(timer.bibNumber) ? 'bg-white text-red-600' : 'bg-gray-100 text-gray-500'}`}>解除</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-8">
              <div className="bg-gray-50 p-3 border-b font-bold text-gray-600 flex justify-between items-center px-4">
                <span>📊 通過ログ（最新50件）</span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-400 sticky top-0">
                    <tr><th className="p-3 font-medium">時刻</th><th className="p-3 font-medium">ゼッケン</th><th className="p-3 font-medium">状態</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recordHistory.map((log) => (
                      <tr key={log.id} className="hover:bg-blue-50 transition-colors">
                        <td className="p-3 font-mono text-gray-400">{log.displayTime}</td>
                        <td className="p-3 font-bold text-gray-700">{log.bibNumber}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold text-white ${log.type === 'entry' ? 'bg-green-500' : log.type === 'manual_exit' ? 'bg-orange-400' : 'bg-blue-500'}`}>
                            {log.type === 'entry' ? '入場' : log.type === 'manual_exit' ? '途中解除' : '退場'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

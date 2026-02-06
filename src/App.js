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

  // Tesseract.js の読み込み
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => {
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

  // --- カメラ起動：インライン再生を強制する最強設定 ---
  const requestCameraPermission = async () => {
    if (streamRef.current) {
        stopCamera();
    }
    
    try {
      const constraints = {
        video: { 
          facingMode: { ideal: "environment" }, // 背面カメラ
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        // 重要：srcObjectを入れる前に再生設定を固める
        videoRef.current.muted = true;
        videoRef.current.setAttribute("autoplay", "");
        videoRef.current.setAttribute("muted", "");
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("webkit-playsinline", "true"); // iOS Safari用
        
        videoRef.current.srcObject = stream;
        
        // 再生が開始されるまで待つ
        await videoRef.current.play();
        setIsCameraActive(true);
        startDetection();
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("カメラの起動に失敗しました。ブラウザのカメラアクセスを許可してください。");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    setIsCameraActive(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startDetection = () => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    detectionIntervalRef.current = setInterval(captureAndDetect, 2000);
  };

  const captureAndDetect = async () => {
    if (!videoRef.current || !canvasRef.current || !tesseractRef.current || !isCameraActive) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    if (videoRef.current.videoWidth > 0) {
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);
      try {
        const result = await tesseractRef.current.recognize(canvas, 'eng', { tessedit_char_whitelist: '0123456789' });
        const numbers = result.data.text.match(/\d+/g);
        if (numbers && numbers.length > 0) {
          const bib = numbers[0];
          setDetectedNumber(bib);
          if (selectedDistance && !timers[bib]) startTimerForBib(bib);
        }
      } catch (err) { console.error("OCR error:", err); }
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
      <div className="bg-white shadow-sm border-b-2 border-blue-600 p-4 sticky top-0 z-50">
        <h1 className="text-xl font-bold text-center text-blue-800">競歩ペナルティー管理</h1>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="bg-white rounded-lg shadow-md border overflow-hidden">
          <button onClick={() => setIsAccordionOpen(!isAccordionOpen)} className="w-full p-4 bg-blue-600 text-white flex justify-between font-bold items-center">
            {selectedDistance ? `距離: ${selectedDistance}km` : '1. まず距離を選択'}
            <span className="text-xl">{isAccordionOpen ? '▲' : '▼'}</span>
          </button>
          {isAccordionOpen && (
            <div className="p-4 grid grid-cols-2 gap-3">
              {distances.map(d => (
                <button key={d.value} onClick={() => selectDistance(d.value)} className="p-4 bg-gray-50 border-2 border-gray-200 rounded-xl font-bold">
                  {d.label}<br/><span className="text-xs text-gray-500 font-normal">{getTimerDuration(d.value)}秒</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedDistance && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl shadow-lg border-2 border-blue-100">
              <div className="flex gap-2 mb-4">
                <input type="number" inputMode="numeric" value={manualInput} onChange={(e) => setManualInput(e.target.value)} placeholder="ゼッケン" className="flex-1 border-2 border-gray-200 p-3 rounded-lg text-lg outline-none" />
                <button onClick={() => { if(manualInput) { startTimerForBib(manualInput); setManualInput(''); } }} className="bg-green-600 text-white px-6 rounded-lg font-bold shadow-md">追加</button>
              </div>
              
              {/* カメラ表示エリア */}
              <div className="relative w-full bg-black rounded-xl overflow-hidden shadow-2xl" style={{ aspectRatio: '4 / 3' }}>
                {!isCameraActive ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                     <button onClick={requestCameraPermission} className="bg-blue-600 text-white px-8 py-4 rounded-full font-bold shadow-xl animate-bounce">
                       📹 カメラを起動
                     </button>
                  </div>
                ) : (
                  <div className="w-full h-full">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      muted 
                      playsInline 
                      webkit-playsinline="true"
                      className="w-full h-full object-cover"
                      style={{ background: '#000' }}
                    />
                    <button onClick={stopCamera} className="absolute top-4 right-4 bg-red-600/80 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg">停止</button>
                    {detectedNumber && <div className="absolute bottom-4 left-4 bg-blue-700/90 text-white px-4 py-2 rounded-lg font-black text-xl shadow-2xl">読み取り: {detectedNumber}</div>}
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="grid gap-3">
              {Object.values(timers).map(timer => (
                <div key={timer.bibNumber} className={`p-4 rounded-xl border-4 ${expiredTimers.has(timer.bibNumber) ? 'bg-red-600 text-white border-yellow-400' : 'bg-white border-blue-500 shadow-md'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold opacity-80 uppercase">BIB No.</span>
                      <div className="text-4xl font-black">{timer.bibNumber}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold opacity-80 uppercase">Remaining</span>
                      <div className="text-5xl font-mono font-black">{formatTime(timer.remaining)}</div>
                    </div>
                    <button onClick={() => removeTimer(timer.bibNumber)} className={`ml-4 px-4 py-3 rounded-lg font-black text-sm ${expiredTimers.has(timer.bibNumber) ? 'bg-white text-red-600' : 'bg-gray-100 text-gray-500'}`}>解除</button>
                  </div>
                </div>
              ))}
            </div>

            {/* 履歴 */}
            <div className="bg-white rounded-xl shadow border overflow-hidden mt-8">
              <div className="bg-gray-800 p-3 font-bold text-white text-center">履歴</div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 font-bold">
                    <tr><th className="p-3">時刻</th><th className="p-3">BIB</th><th className="p-3">状態</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {recordHistory.map((log) => (
                      <tr key={log.id} className="hover:bg-blue-50">
                        <td className="p-3 text-gray-400 font-mono">{log.displayTime}</td>
                        <td className="p-3 font-black">{log.bibNumber}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold text-white ${log.type === 'entry' ? 'bg-green-500' : 'bg-blue-500'}`}>
                            {log.type === 'entry' ? '入場' : '退場'}
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

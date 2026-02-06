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
  // 二重記録を防止するための「すでに記録したID」の管理
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

  // --- カメラ機能の修正（より確実に） ---
  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().catch(e => console.error("Play error:", e));
          setIsCameraActive(true);
          startDetection();
        };
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("カメラの起動に失敗しました。ブラウザの権限設定を確認してください。");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    setIsCameraActive(false);
  };

  const startDetection = () => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    detectionIntervalRef.current = setInterval(captureAndDetect, 2000);
  };

  const captureAndDetect = async () => {
    if (!videoRef.current || !canvasRef.current || !tesseractRef.current || !isCameraActive) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
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
  };

  const startTimerForBib = (bibNumber) => {
    if (timers[bibNumber]) return;

    const duration = getTimerDuration(selectedDistance);
    const startTime = new Date();
    const entryId = `entry-${bibNumber}-${Date.now()}`;
    const endTime = Date.now() + duration * 1000;
    
    // 入場ログを一度だけ記録
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

          // 二重記録ガード：このIDがまだ記録されていなければ追加
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
      // 終了前に手動で消された場合のみ記録
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
      `}</style>

      <div className="bg-white shadow-sm border-b-2 border-blue-600 p-4">
        <h1 className="text-xl font-bold text-center">競歩ペナルティーゾーン管理</h1>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="bg-white rounded-lg shadow border overflow-hidden">
          <button onClick={() => setIsAccordionOpen(!isAccordionOpen)} className="w-full p-4 bg-blue-600 text-white flex justify-between font-bold">
            {selectedDistance ? `距離: ${selectedDistance}km (${getTimerDuration(selectedDistance)}秒)` : '距離を選択してください'}
            <span>{isAccordionOpen ? '▲' : '▼'}</span>
          </button>
          {isAccordionOpen && (
            <div className="p-4 grid grid-cols-2 gap-2">
              {distances.map(d => (
                <button key={d.value} onClick={() => selectDistance(d.value)} className="p-3 bg-gray-100 rounded hover:bg-gray-200">
                  {d.label} ({getTimerDuration(d.value)}秒)
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedDistance && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg shadow border">
              <div className="flex gap-2 mb-4">
                <input type="text" value={manualInput} onChange={(e) => setManualInput(e.target.value.replace(/\D/g, ''))} placeholder="ゼッケン番号" className="flex-1 border p-2 rounded" />
                <button onClick={() => { if(manualInput) { startTimerForBib(manualInput); setManualInput(''); } }} className="bg-green-600 text-white px-4 rounded font-bold">追加</button>
              </div>
              
              {!isCameraActive ? (
                <button onClick={requestCameraPermission} className="w-full p-3 bg-blue-600 text-white rounded font-bold transition hover:bg-blue-700">📹 カメラ起動</button>
              ) : (
                <div className="relative">
                  {/* ここにスタイルを追加しました */}
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    muted 
                    playsInline 
                    className="w-full rounded border bg-black" 
                    style={{ minHeight: '300px', objectFit: 'cover' }}
                  />
                  <button onClick={stopCamera} className="absolute top-2 right-2 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">停止</button>
                  {detectedNumber && <div className="absolute bottom-2 left-2 bg-blue-600 text-white p-2 rounded shadow-lg animate-bounce">検出: {detectedNumber}</div>}
                </div>
              )}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            <div className="space-y-2">
              {Object.values(timers).length === 0 && <p className="text-center text-gray-400 py-4 italic">現在待機中の選手はいません</p>}
              {Object.values(timers).map(timer => (
                <div key={timer.bibNumber} className={`p-4 rounded-lg border-2 transition-all ${expiredTimers.has(timer.bibNumber) ? 'bg-red-500 text-white expired-alert border-red-700 shadow-lg' : 'bg-white border-gray-200 shadow-sm'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs uppercase opacity-70">BIB No.</span>
                      <div className="text-3xl font-black">{timer.bibNumber}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs uppercase opacity-70">Remaining</span>
                      <div className="text-4xl font-mono font-bold leading-none">{formatTime(timer.remaining)}</div>
                    </div>
                    <button onClick={() => removeTimer(timer.bibNumber)} className={`ml-4 px-3 py-2 rounded font-bold text-xs ${expiredTimers.has(timer.bibNumber) ? 'bg-white text-red-600' : 'bg-gray-100 text-gray-500'}`}>解除</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-lg shadow border overflow-hidden mt-8">
              <div className="bg-gray-50 p-3 border-b font-bold text-gray-700 flex justify-between items-center">
                <span>入出記録（履歴）</span>
                <span className="text-xs font-normal text-gray-400">最新50件</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-3">時刻</th>
                      <th className="p-3">ゼッケン</th>
                      <th className="p-3">種別</th>
                      <th className="p-3">距離</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recordHistory.length === 0 ? (
                      <tr><td colSpan="4" className="p-4 text-center text-gray-400">まだ記録はありません</td></tr>
                    ) : (
                      recordHistory.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50 transition">
                          <td className="p-3 font-mono text-gray-500">{log.displayTime}</td>
                          <td className="p-3 font-bold text-gray-800">{log.bibNumber}</td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${log.type === 'entry' ? 'bg-green-100 text-green-700' : log.type === 'manual_exit' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                              {log.type === 'entry' ? '入場' : log.type === 'manual_exit' ? '途中解除' : '退場'}
                            </span>
                          </td>
                          <td className="p-3 text-gray-500">{log.distance}km</td>
                        </tr>
                      ))
                    )}
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

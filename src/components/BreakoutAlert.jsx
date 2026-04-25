import { useEffect, useRef, memo } from 'react';
import { Zap, X, Volume2 } from 'lucide-react';

function formatPrice(price) {
  if (price == null) return '—';
  return `₹${Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Generate alert beep sound using Web Audio API
function playAlertSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play three ascending beeps
    const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
    frequencies.forEach((freq, i) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.15);
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime + i * 0.15);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + i * 0.15 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.15 + 0.3);
      
      oscillator.start(audioCtx.currentTime + i * 0.15);
      oscillator.stop(audioCtx.currentTime + i * 0.15 + 0.3);
    });

    // Play success chord after beeps
    setTimeout(() => {
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach(freq => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 1);
      });
    }, 500);
  } catch (e) {
    console.warn('Could not play alert sound:', e);
  }
}

export default memo(function BreakoutAlert({ alerts, onDismiss }) {
  const soundPlayedRef = useRef(new Set());

  useEffect(() => {
    if (alerts.length > 0) {
      const newAlerts = alerts.filter(a => !soundPlayedRef.current.has(a.symbol + a.timestamp));
      if (newAlerts.length > 0) {
        playAlertSound();
        newAlerts.forEach(a => soundPlayedRef.current.add(a.symbol + a.timestamp));

        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          newAlerts.forEach(a => {
            new Notification(`🚀 IPO BREAKOUT: ${a.symbol}`, {
              body: `${a.symbol} crossed Day 1 High of ${formatPrice(a.day1High)} at ${formatPrice(a.price)} (+${a.percentAbove}%)`,
              icon: '📈',
              tag: a.symbol
            });
          });
        }
      }
    }
  }, [alerts]);

  // Request notification permission on component mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 space-y-3 max-w-sm w-full">
      {alerts.map((alert, index) => (
        <div
          key={`${alert.symbol}-${alert.timestamp}-${index}`}
          className="breakout-notification"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-neon-green)]/20 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5 text-[var(--color-neon-green)]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-[var(--color-neon-green)]">
                    🚀 BREAKOUT!
                  </span>
                  <Volume2 className="w-3.5 h-3.5 text-[var(--color-neon-green)] animate-pulse" />
                </div>
                <p className="text-sm font-semibold mt-0.5">{alert.symbol}</p>
                <p className="text-xs text-[var(--color-dark-200)] mt-1">
                  Crossed Day 1 High of {formatPrice(alert.day1High)}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs font-mono text-[var(--color-neon-green)] font-bold">
                    {formatPrice(alert.price)}
                  </span>
                  <span className="badge badge-green text-[10px]">
                    +{alert.percentAbove}%
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onDismiss(index)}
              className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

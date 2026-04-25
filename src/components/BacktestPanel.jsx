import { useState } from 'react';
import { History, Search, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../services/api';

function formatPrice(p) {
  return p == null ? '—' : `₹${Number(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BacktestPanel() {
  const [symbol, setSymbol] = useState('');
  const [listingDate, setListingDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const run = async () => {
    if (!symbol || !listingDate) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await api.getHistory(symbol, listingDate);
      if (!res.success || !res.data.length) { setError('No data found'); setLoading(false); return; }
      const candles = res.data;
      const day1High = candles[0].high;
      let breakoutIdx = candles.findIndex((c, i) => i > 0 && c.high > day1High);
      const last = candles[candles.length - 1];
      setResult({
        symbol: symbol.toUpperCase(),
        day1High,
        didBreak: breakoutIdx > 0,
        daysToBreak: breakoutIdx > 0 ? breakoutIdx : null,
        breakDate: breakoutIdx > 0 ? candles[breakoutIdx].date : null,
        lastClose: last.close,
        returns: (((last.close - candles[0].open) / candles[0].open) * 100).toFixed(2),
        totalDays: candles.length,
      });
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-[var(--color-neon-purple)]/10 flex items-center justify-center">
          <History className="w-5 h-5 text-[var(--color-neon-purple)]" />
        </div>
        <div>
          <h3 className="font-bold text-sm">Quick Backtest</h3>
          <p className="text-[11px] text-[var(--color-dark-300)]">Did this IPO break Day 1 High?</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input-dark flex-1 min-w-[120px]" placeholder="Symbol (e.g. ZOMATO)" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />
        <input type="date" className="input-dark flex-1 min-w-[120px]" value={listingDate} onChange={e => setListingDate(e.target.value)} />
        <button onClick={run} disabled={loading} className="btn-primary flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Test
        </button>
      </div>

      {error && <p className="text-sm text-[var(--color-neon-red)]">{error}</p>}

      {result && (
        <div className={`p-4 rounded-xl border ${result.didBreak ? 'bg-[var(--color-neon-green)]/5 border-[var(--color-neon-green)]/20' : 'bg-[var(--color-neon-red)]/5 border-[var(--color-neon-red)]/20'}`}>
          <div className="flex items-center gap-2 mb-3">
            {result.didBreak ? <TrendingUp className="w-5 h-5 text-[var(--color-neon-green)]" /> : <TrendingDown className="w-5 h-5 text-[var(--color-neon-red)]" />}
            <span className="font-bold">{result.symbol} — {result.didBreak ? '✅ Broke Day 1 High!' : '❌ Never broke Day 1 High'}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-[var(--color-dark-300)]">Day 1 High</span><p className="font-mono font-bold text-[var(--color-neon-yellow)]">{formatPrice(result.day1High)}</p></div>
            {result.didBreak && <div><span className="text-[var(--color-dark-300)]">Broke on Day</span><p className="font-mono font-bold text-[var(--color-neon-green)]">{result.daysToBreak} ({result.breakDate})</p></div>}
            <div><span className="text-[var(--color-dark-300)]">Last Close</span><p className="font-mono font-bold">{formatPrice(result.lastClose)}</p></div>
            <div><span className="text-[var(--color-dark-300)]">Returns</span><p className={`font-mono font-bold ${parseFloat(result.returns) >= 0 ? 'price-up' : 'price-down'}`}>{result.returns > 0 ? '+' : ''}{result.returns}%</p></div>
          </div>
        </div>
      )}
    </div>
  );
}

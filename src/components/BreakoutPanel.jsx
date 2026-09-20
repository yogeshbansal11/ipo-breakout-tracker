import { Zap, Clock, TrendingUp, Trash2, CalendarDays } from 'lucide-react';
import { api } from '../services/api';
import toast from 'react-hot-toast';

function formatPrice(price) {
  if (price == null) return '—';
  return `₹${Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function daysAfterListing(listingDate, breakoutTimestamp) {
  if (!listingDate || !breakoutTimestamp) return null;
  const listing = new Date(listingDate);
  const breakout = new Date(breakoutTimestamp);
  const diff = Math.floor((breakout - listing) / (1000 * 60 * 60 * 24));
  return diff <= 0 ? 'Day 1' : `Day ${diff + 1}`;
}

function breakoutBadgeStyle(pct) {
  const p = parseFloat(pct);
  if (p >= 10) return { background: 'rgba(0,255,136,0.25)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.5)' };
  if (p >= 5)  return { background: 'rgba(0,255,136,0.18)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.35)' };
  return {};
}

export default function BreakoutPanel({ stocks, onRefresh }) {
  const breakoutStocks = stocks.filter(s => s.breakoutTriggered);

  const handleClearAll = async () => {
    if (!confirm('Clear all breakout history?')) return;
    try {
      await api.clearBreakouts();
      // Reset all breakout flags
      for (const stock of breakoutStocks) {
        await api.resetBreakout(stock.symbol);
      }
      toast.success('Breakout history cleared', {
        style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' }
      });
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-neon-green/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-neon-green" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Breakout Triggered</h3>
            <p className="text-[11px] text-dark-300">
              Stocks that crossed Day 1 High (+0.5% min)
            </p>
          </div>
        </div>
        {breakoutStocks.length > 0 && (
          <button onClick={handleClearAll} className="btn-ghost flex items-center gap-1.5 text-xs">
            <Trash2 className="w-3 h-3" />
            Clear All
          </button>
        )}
      </div>

      {/* Content */}
      {breakoutStocks.length === 0 ? (
        <div className="p-8 text-center">
          <Zap className="w-10 h-10 text-dark-400 mx-auto mb-3" />
          <p className="text-sm text-dark-300">
            No breakouts yet. Waiting for stocks to cross Day 1 High...
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/3">
          {breakoutStocks
            .sort((a, b) => new Date(b.breakoutTimestamp) - new Date(a.breakoutTimestamp))
            .map((stock) => {
              const percentAbove = stock.day1High
                ? (((stock.breakoutPrice - stock.day1High) / stock.day1High) * 100).toFixed(2)
                : 0;
              const dayLabel = daysAfterListing(stock.listingDate, stock.breakoutTimestamp);
              const badgeStyle = breakoutBadgeStyle(percentAbove);

              return (
                <div key={stock.id} className="p-4 hover:bg-white/2 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-neon-green/15 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-neon-green" />
                      </div>
                      <div>
                        <span className="font-bold text-sm">{stock.symbol}</span>
                        <span className="text-xs text-dark-300 ml-2">{stock.name}</span>
                      </div>
                    </div>
                    <span className="badge badge-green text-[11px]" style={badgeStyle}>
                      +{percentAbove}%
                    </span>
                  </div>
                  <div className="ml-11 flex flex-wrap gap-4 text-xs text-dark-200">
                    <span>
                      Day 1 High: <span className="font-mono text-neon-yellow">{formatPrice(stock.day1High)}</span>
                    </span>
                    <span>
                      Breakout at: <span className="font-mono text-neon-green">{formatPrice(stock.breakoutPrice)}</span>
                    </span>
                  </div>
                  <div className="ml-11 mt-1.5 flex items-center gap-3 text-[11px] text-dark-300">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(stock.breakoutTimestamp)}
                    </span>
                    {dayLabel && (
                      <span className="flex items-center gap-1 text-neon-yellow/70">
                        <CalendarDays className="w-3 h-3" />
                        {dayLabel} after listing
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

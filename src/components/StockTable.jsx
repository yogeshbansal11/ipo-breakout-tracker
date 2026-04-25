import { memo } from 'react';
import { Trash2, Eye, EyeOff, RotateCcw, TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';
import { api } from '../services/api';
import toast from 'react-hot-toast';

function formatPrice(price) {
  if (price == null) return '—';
  return `₹${Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(val) {
  if (val == null) return '';
  const num = Number(val);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function PriceChangeIndicator({ current, day1High }) {
  if (!current || !day1High) return <Minus className="w-3.5 h-3.5 text-[var(--color-dark-300)]" />;
  if (current > day1High) return <TrendingUp className="w-3.5 h-3.5 text-[var(--color-neon-green)]" />;
  return <TrendingDown className="w-3.5 h-3.5 text-[var(--color-neon-red)]" />;
}

function ProgressToBreakout({ current, day1High }) {
  if (!current || !day1High) return null;
  const progress = Math.min((current / day1High) * 100, 150);
  const isAbove = current > day1High;
  
  return (
    <div className="flex items-center gap-2">
      <div className="progress-container flex-1">
        <div 
          className="progress-bar"
          style={{ 
            width: `${Math.min(progress, 100)}%`,
            background: isAbove 
              ? 'linear-gradient(90deg, var(--color-neon-green), var(--color-neon-blue))' 
              : progress > 90 
                ? 'linear-gradient(90deg, var(--color-neon-orange), var(--color-neon-yellow))'
                : 'linear-gradient(90deg, var(--color-dark-400), var(--color-dark-300))'
          }}
        />
      </div>
      <span className={`text-[10px] font-mono font-bold ${
        isAbove ? 'text-[var(--color-neon-green)]' : 'text-[var(--color-dark-200)]'
      }`}>
        {progress.toFixed(1)}%
      </span>
    </div>
  );
}

export default memo(function StockTable({ stocks, onRefresh }) {
  const handleToggle = async (symbol) => {
    try {
      await api.toggleMonitoring(symbol);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRemove = async (symbol) => {
    if (!confirm(`Remove ${symbol} from tracking?`)) return;
    try {
      await api.removeStock(symbol);
      toast.success(`${symbol} removed`, {
        style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' }
      });
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleReset = async (symbol) => {
    try {
      await api.resetBreakout(symbol);
      toast.success(`Breakout reset for ${symbol}`, {
        style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' }
      });
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (stocks.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="w-8 h-8 text-[var(--color-dark-400)]" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-dark-200)] mb-2">No Stocks Being Tracked</h3>
        <p className="text-sm text-[var(--color-dark-300)] max-w-md mx-auto">
          Add your first IPO stock to start monitoring for Day 1 High breakouts.
          Click the "Add IPO" button above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="stock-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Listing Date</th>
              <th>Day 1 High</th>
              <th>Current Price</th>
              <th>Distance</th>
              <th>Status</th>
              <th>Progress</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => {
              const distance = stock.currentPrice && stock.day1High 
                ? ((stock.currentPrice - stock.day1High) / stock.day1High * 100) 
                : null;
              
              return (
                <tr 
                  key={stock.id} 
                  className={stock.breakoutTriggered ? 'breakout-row' : ''}
                >
                  {/* Stock Info */}
                  <td>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                        stock.breakoutTriggered 
                          ? 'bg-[var(--color-neon-green)]/15 text-[var(--color-neon-green)]' 
                          : 'bg-white/5 text-[var(--color-dark-200)]'
                      }`}>
                        {stock.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{stock.symbol}</div>
                        <div className="text-[11px] text-[var(--color-dark-300)] truncate max-w-[140px]">
                          {stock.name}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Listing Date */}
                  <td className="text-[var(--color-dark-200)] text-xs font-mono">
                    {stock.listingDate || '—'}
                  </td>

                  {/* Day 1 High */}
                  <td>
                    <span className="font-mono font-semibold text-[var(--color-neon-yellow)]">
                      {formatPrice(stock.day1High)}
                    </span>
                  </td>

                  {/* Current Price */}
                  <td>
                    <div className="flex items-center gap-2">
                      <PriceChangeIndicator current={stock.currentPrice} day1High={stock.day1High} />
                      <span className={`font-mono font-semibold ${
                        stock.currentPrice > stock.day1High 
                          ? 'text-[var(--color-neon-green)]' 
                          : 'text-[var(--color-dark-100)]'
                      }`}>
                        {formatPrice(stock.currentPrice)}
                      </span>
                    </div>
                  </td>

                  {/* Distance */}
                  <td>
                    {distance != null ? (
                      <span className={`font-mono text-xs font-bold ${
                        distance > 0 ? 'price-up' : 'price-down'
                      }`}>
                        {formatPercent(distance)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-dark-400)]">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td>
                    {stock.breakoutTriggered ? (
                      <span className="badge badge-green">
                        <Zap className="w-3 h-3" />
                        BREAKOUT
                      </span>
                    ) : stock.isMonitoring ? (
                      <span className="badge badge-blue">
                        <Eye className="w-3 h-3" />
                        WATCHING
                      </span>
                    ) : (
                      <span className="badge badge-yellow">
                        <EyeOff className="w-3 h-3" />
                        PAUSED
                      </span>
                    )}
                  </td>

                  {/* Progress */}
                  <td className="min-w-[120px]">
                    <ProgressToBreakout current={stock.currentPrice} day1High={stock.day1High} />
                  </td>

                  {/* Actions */}
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggle(stock.symbol)}
                        className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                        title={stock.isMonitoring ? 'Pause' : 'Resume'}
                      >
                        {stock.isMonitoring ? (
                          <EyeOff className="w-3.5 h-3.5 text-[var(--color-dark-200)]" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-[var(--color-neon-blue)]" />
                        )}
                      </button>
                      {stock.breakoutTriggered && (
                        <button
                          onClick={() => handleReset(stock.symbol)}
                          className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                          title="Reset Breakout"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-[var(--color-neon-orange)]" />
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(stock.symbol)}
                        className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-[var(--color-neon-red)]/10 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-[var(--color-neon-red)]" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

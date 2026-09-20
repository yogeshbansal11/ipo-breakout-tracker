import { memo, useState } from 'react';
import { Trash2, Eye, EyeOff, RotateCcw, TrendingUp, TrendingDown, Minus, Zap, Scissors } from 'lucide-react';
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

/**
 * Compute setup quality for a stock.
 *
 * Pre-breakout tiers (sorted by proximity to Day 1 High):
 *   PRIME      — within 3%  → best risk-reward, breakout imminent
 *   NEAR       — within 8%  → approaching, worth watching closely
 *   WATCH      — within 20% → in the zone, building base
 *   LAGGING    — 20-50% below → weak, unlikely near-term breakout
 *
 * Post-breakout tiers (sorted by freshness/extension):
 *   FRESH      — broke out ≤5 days ago, ≤15% extended → ideal momentum entry
 *   MOMENTUM   — broke out ≤14 days ago, ≤25% extended → still valid
 *   EXTENDED   — broke out, >25% above D1H → poor risk-reward, avoid chasing
 */
/** Minimum Day 1 high-to-low range for a setup worth trading (see server dataStore). */
const MIN_DAY1_RANGE_PCT = 10;

function day1RangePct(stock) {
  if (stock.day1High == null || !stock.day1Low) return null;
  return ((stock.day1High - stock.day1Low) / stock.day1Low) * 100;
}

function computeSetup(stock) {
  const today = new Date();
  const distance =
    stock.currentPrice && stock.day1High
      ? ((stock.currentPrice - stock.day1High) / stock.day1High) * 100
      : null;

  // A flat first day makes the Day 1 High a level nobody contested — backtesting
  // 279 breakouts, these won 30% at 1:2 and lost money, versus 46% for the rest.
  // Flag them regardless of how close price is to the level.
  const rangePct = day1RangePct(stock);
  if (rangePct !== null && rangePct < MIN_DAY1_RANGE_PCT) {
    return { label: 'WEAK D1', color: 'grey', score: 0, tip: `Day 1 range only ${rangePct.toFixed(1)}% — below the ${MIN_DAY1_RANGE_PCT}% minimum, historically unprofitable` };
  }

  if (stock.breakoutTriggered && stock.breakoutTimestamp) {
    const daysSince = Math.floor(
      (today - new Date(stock.breakoutTimestamp)) / (1000 * 60 * 60 * 24)
    );
    if (distance !== null && distance > 25)
      return { label: 'EXTENDED', color: 'orange', score: 1, tip: `+${distance.toFixed(1)}% above D1H — over-extended` };
    if (daysSince <= 5)
      return { label: 'FRESH', color: 'green', score: 5, tip: `Broke out ${daysSince}d ago` };
    if (daysSince <= 14)
      return { label: 'MOMENTUM', color: 'teal', score: 4, tip: `Broke out ${daysSince}d ago` };
    return { label: 'EXTENDED', color: 'orange', score: 2, tip: `Broke out ${daysSince}d ago` };
  }

  if (distance === null)
    return { label: 'WATCH', color: 'blue', score: 2, tip: 'No price data yet' };
  if (distance >= -3)
    return { label: 'PRIME', color: 'yellow', score: 5, tip: `${distance.toFixed(1)}% from D1H — breakout imminent` };
  if (distance >= -8)
    return { label: 'NEAR', color: 'yellow', score: 4, tip: `${distance.toFixed(1)}% from D1H — approaching` };
  if (distance >= -20)
    return { label: 'WATCH', color: 'blue', score: 3, tip: `${distance.toFixed(1)}% from D1H` };
  return { label: 'LAGGING', color: 'grey', score: 1, tip: `${distance.toFixed(1)}% from D1H — far from breakout` };
}

const BADGE_STYLES = {
  green:  { background: 'rgba(0,255,136,0.15)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.35)' },
  teal:   { background: 'rgba(0,210,180,0.15)', color: '#00d2b4', border: '1px solid rgba(0,210,180,0.35)' },
  yellow: { background: 'rgba(255,210,0,0.15)',  color: '#ffd200', border: '1px solid rgba(255,210,0,0.35)' },
  blue:   { background: 'rgba(80,160,255,0.12)', color: '#66aaff', border: '1px solid rgba(80,160,255,0.3)' },
  orange: { background: 'rgba(255,140,0,0.15)',  color: '#ff8c00', border: '1px solid rgba(255,140,0,0.35)' },
  grey:   { background: 'rgba(255,255,255,0.05)', color: '#888',   border: '1px solid rgba(255,255,255,0.1)' },
};

function PriceChangeIndicator({ current, day1High }) {
  if (!current || !day1High) return <Minus className="w-3.5 h-3.5 text-dark-300" />;
  if (current > day1High)    return <TrendingUp className="w-3.5 h-3.5 text-neon-green" />;
  return                            <TrendingDown className="w-3.5 h-3.5 text-neon-red" />;
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
                : 'linear-gradient(90deg, var(--color-dark-400), var(--color-dark-300))',
          }}
        />
      </div>
      <span className={`text-[10px] font-mono font-bold ${isAbove ? 'text-neon-green' : 'text-dark-200'}`}>
        {progress.toFixed(1)}%
      </span>
    </div>
  );
}

export default memo(function StockTable({ stocks, onRefresh }) {
  const [pruning, setPruning] = useState(false);

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
        style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' },
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
        style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' },
      });
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handlePrune = async () => {
    if (!confirm('Remove stocks listed >45 days ago, with a Day 1 range under 10%, or trading >5% below their Day 1 High?')) return;
    setPruning(true);
    try {
      const result = await api.pruneWatchlist();
      if (result.count === 0) {
        toast.success('Watchlist is already clean — nothing to remove.', {
          style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' },
        });
      } else {
        toast.success(`Pruned ${result.count} stock${result.count > 1 ? 's' : ''} from watchlist`, {
          style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(0,255,136,0.2)' },
          duration: 5000,
        });
      }
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
    setPruning(false);
  };

  // Sort by setup score descending (best opportunities first)
  const sorted = [...stocks].sort((a, b) => computeSetup(b).score - computeSetup(a).score);

  if (sorted.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="w-8 h-8 text-dark-400" />
        </div>
        <h3 className="text-lg font-semibold text-dark-200 mb-2">No Stocks Being Tracked</h3>
        <p className="text-sm text-dark-300 max-w-md mx-auto">
          Add your first IPO stock to start monitoring for Day 1 High breakouts.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      {/* Prune toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <span className="text-xs text-dark-300">
          {sorted.length} stock{sorted.length !== 1 ? 's' : ''} · listed ≤ 45d, Day 1 range ≥ 10%, within 5% of Day 1 High
        </span>
        <button
          onClick={handlePrune}
          disabled={pruning}
          className="btn-ghost flex items-center gap-1.5 text-xs"
          title="Remove stocks listed more than 45 days ago, stocks whose Day 1 range is under 10% (historically unprofitable), and stocks trading more than 5% below their Day 1 High"
        >
          <Scissors className="w-3 h-3" />
          {pruning ? 'Pruning…' : 'Prune Watchlist'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="stock-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Listing Date</th>
              <th>Day 1 High</th>
              <th>D1 Range</th>
              <th>Current Price</th>
              <th>Distance</th>
              <th>Setup</th>
              <th>Progress</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((stock) => {
              const distance =
                stock.currentPrice && stock.day1High
                  ? ((stock.currentPrice - stock.day1High) / stock.day1High) * 100
                  : null;
              const setup = computeSetup(stock);
              const badgeStyle = BADGE_STYLES[setup.color] ?? BADGE_STYLES.grey;

              return (
                <tr
                  key={stock.id}
                  className={stock.breakoutTriggered ? 'breakout-row' : ''}
                  style={
                    setup.score >= 4
                      ? { borderLeft: `2px solid ${badgeStyle.color}` }
                      : undefined
                  }
                >
                  {/* Stock Info */}
                  <td>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                        style={{
                          background: badgeStyle.background,
                          color: badgeStyle.color,
                        }}
                      >
                        {stock.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{stock.symbol}</div>
                        <div className="text-[11px] text-dark-300 truncate max-w-35">
                          {stock.name}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Listing Date */}
                  <td className="text-dark-200 text-xs font-mono">{stock.listingDate || '—'}</td>

                  {/* Day 1 High */}
                  <td>
                    <span className="font-mono font-semibold text-neon-yellow">
                      {formatPrice(stock.day1High)}
                    </span>
                  </td>

                  {/* Day 1 Range — the setup-quality filter */}
                  <td>
                    {(() => {
                      const r = day1RangePct(stock);
                      if (r == null) return <span className="text-dark-400">—</span>;
                      const ok = r >= MIN_DAY1_RANGE_PCT;
                      return (
                        <span
                          className="font-mono text-xs font-bold"
                          style={{ color: ok ? '#00ff88' : '#888' }}
                          title={ok
                            ? `${r.toFixed(1)}% — wide enough for the Day 1 High to be a real level`
                            : `${r.toFixed(1)}% — flat first day, historically a losing setup`}
                        >
                          {r.toFixed(1)}%
                        </span>
                      );
                    })()}
                  </td>

                  {/* Current Price */}
                  <td>
                    <div className="flex items-center gap-2">
                      <PriceChangeIndicator current={stock.currentPrice} day1High={stock.day1High} />
                      <span
                        className="font-mono font-semibold"
                        style={{ color: stock.currentPrice > stock.day1High ? '#00ff88' : undefined }}
                      >
                        {formatPrice(stock.currentPrice)}
                      </span>
                    </div>
                  </td>

                  {/* Distance */}
                  <td>
                    {distance != null ? (
                      <span className={`font-mono text-xs font-bold ${distance > 0 ? 'price-up' : 'price-down'}`}>
                        {formatPercent(distance)}
                      </span>
                    ) : (
                      <span className="text-dark-400">—</span>
                    )}
                  </td>

                  {/* Setup Quality */}
                  <td>
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold"
                      style={badgeStyle}
                      title={setup.tip}
                    >
                      {setup.label === 'FRESH' || setup.label === 'PRIME' ? (
                        <Zap className="w-2.5 h-2.5" />
                      ) : null}
                      {setup.label}
                    </span>
                  </td>

                  {/* Progress */}
                  <td className="min-w-30">
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
                          <EyeOff className="w-3.5 h-3.5 text-dark-200" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-neon-blue" />
                        )}
                      </button>
                      {stock.breakoutTriggered && (
                        <button
                          onClick={() => handleReset(stock.symbol)}
                          className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                          title="Reset Breakout"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-neon-orange" />
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(stock.symbol)}
                        className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-neon-red/10 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-neon-red" />
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

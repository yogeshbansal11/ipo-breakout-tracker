import { memo } from 'react';
import { BarChart3, Eye, Zap, Clock } from 'lucide-react';

export default memo(function StatsBar({ stocks }) {
  const totalStocks = stocks.length;
  const monitoring = stocks.filter(s => s.isMonitoring && !s.breakoutTriggered).length;
  const breakouts = stocks.filter(s => s.breakoutTriggered).length;
  const pending = stocks.filter(s => !s.breakoutTriggered && s.isMonitoring).length;

  const stats = [
    {
      label: 'Total IPOs',
      value: totalStocks,
      icon: BarChart3,
      color: 'blue',
      accent: 'var(--color-neon-blue)'
    },
    {
      label: 'Monitoring',
      value: monitoring,
      icon: Eye,
      color: 'green',
      accent: 'var(--color-neon-green)'
    },
    {
      label: 'Breakouts',
      value: breakouts,
      icon: Zap,
      color: 'orange',
      accent: 'var(--color-neon-orange)'
    },
    {
      label: 'Pending',
      value: pending,
      icon: Clock,
      color: 'purple',
      accent: 'var(--color-neon-purple)'
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className={`stat-card ${stat.color}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--color-dark-300)] text-xs font-medium uppercase tracking-wider mb-1">
                {stat.label}
              </p>
              <p className="text-2xl font-bold" style={{ color: stat.accent }}>
                {stat.value}
              </p>
            </div>
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${stat.accent}10` }}
            >
              <stat.icon className="w-5 h-5" style={{ color: stat.accent }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

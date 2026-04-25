import { memo } from 'react';
import { TrendingUp, Wifi, WifiOff, Activity } from 'lucide-react';

export default memo(function Header({ isConnected, stockCount }) {
  return (
    <header className="relative z-10 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-neon-green)] to-[var(--color-neon-blue)] flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-black" strokeWidth={2.5} />
              </div>
              {isConnected && (
                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--color-neon-green)] rounded-full border-2 border-[var(--color-dark-900)]" />
              )}
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                IPO Breakout Tracker
              </h1>
              <p className="text-[10px] text-[var(--color-dark-300)] font-medium tracking-widest uppercase">
                Indian Market • NSE/BSE
              </p>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-4">
            {/* Stock Count */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5">
              <Activity className="w-3.5 h-3.5 text-[var(--color-neon-blue)]" />
              <span className="text-xs font-medium text-[var(--color-dark-100)]">
                {stockCount} Stock{stockCount !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Connection Status */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
              isConnected 
                ? 'bg-[var(--color-neon-green)]/5 border-[var(--color-neon-green)]/20' 
                : 'bg-[var(--color-neon-red)]/5 border-[var(--color-neon-red)]/20'
            }`}>
              {isConnected ? (
                <>
                  <div className="live-dot" />
                  <Wifi className="w-3.5 h-3.5 text-[var(--color-neon-green)]" />
                  <span className="text-xs font-semibold text-[var(--color-neon-green)]">LIVE</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-[var(--color-neon-red)]" />
                  <span className="text-xs font-semibold text-[var(--color-neon-red)]">OFFLINE</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});

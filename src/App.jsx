import { useState, useCallback } from 'react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { Plus, LayoutDashboard, Zap, History, Loader2, ShieldCheck } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './services/api';
import Header from './components/Header';
import StatsBar from './components/StatsBar';
import StockTable from './components/StockTable';
import BreakoutPanel from './components/BreakoutPanel';
import BreakoutAlert from './components/BreakoutAlert';
import AddStockModal from './components/AddStockModal';
import BacktestPanel from './components/BacktestPanel';

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

export default function App() {
  const { isConnected, stocks, breakoutAlerts, dismissAlertAtIndex } = useWebSocket(WS_URL);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  const refreshStocks = useCallback(async () => {
    // The WebSocket pushes the authoritative list; this just nudges a refresh,
    // so a failed poll is not worth surfacing to the user.
    try { await api.getStocks(); } catch { /* ignored */ }
  }, []);

  const dismissAlert = useCallback((index) => {
    dismissAlertAtIndex(index);
  }, [dismissAlertAtIndex]);

  const [validating, setValidating] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    toast('Validating all stocks against Yahoo Finance history… this takes ~1 min', {
      icon: '🔍',
      duration: 8000,
      style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)' },
    });
    try {
      const result = await api.validateStocks();
      if (result.count === 0) {
        toast.success('All stocks verified — no false positives found.', {
          style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(0,255,136,0.2)' },
        });
      } else {
        toast.success(
          `Removed ${result.count} old stock${result.count > 1 ? 's' : ''} that weren't genuine IPOs`,
          { duration: 6000, style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(0,255,136,0.2)' } }
        );
      }
    } catch (err) {
      toast.error(err.message);
    }
    setValidating(false);
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'breakouts', label: 'Breakouts', icon: Zap },
    { id: 'backtest', label: 'Backtest', icon: History },
  ];

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="bg-glow" />
      <Toaster position="bottom-right" />

      <BreakoutAlert alerts={breakoutAlerts} onDismiss={dismissAlert} />

      <Header isConnected={isConnected} stockCount={stocks.length} />

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <StatsBar stocks={stocks} />

        {/* Tab Bar + Buttons */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-1 p-1 rounded-xl bg-white/3 border border-white/5">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`tab-btn flex items-center gap-1.5 ${activeTab === tab.id ? 'active' : ''}`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleValidate}
              disabled={validating}
              className="btn-ghost flex items-center gap-2"
              title="Check every tracked stock against Yahoo Finance — removes any old/established companies that were incorrectly added as IPOs"
            >
              {validating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Validating…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Validate IPOs
                </>
              )}
            </button>
            <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add IPO
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'dashboard' && (
          <StockTable stocks={stocks} onRefresh={refreshStocks} />
        )}
        {activeTab === 'breakouts' && (
          <BreakoutPanel stocks={stocks} onRefresh={refreshStocks} />
        )}
        {activeTab === 'backtest' && (
          <BacktestPanel />
        )}

        <footer className="text-center py-6 text-xs text-dark-400">
          IPO Breakout Tracker • Real-time monitoring for NSE/BSE • Data via Yahoo Finance
        </footer>
      </main>

      <AddStockModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onStockAdded={refreshStocks}
      />
    </div>
  );
}

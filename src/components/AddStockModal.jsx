import { useState, useCallback, memo, useRef, useEffect } from 'react';
import { Search, Plus, X, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import toast from 'react-hot-toast';

function AddStockModal({ isOpen, onClose, onStockAdded }) {
  const [mode, setMode] = useState('quick'); // 'quick' or 'manual'
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef(null);
  const inputRef = useRef(null);

  // Quick add form (just symbol + date, auto-fetches Day 1 data)
  const [quickSymbol, setQuickSymbol] = useState('');
  const [quickDate, setQuickDate] = useState('');
  const [quickName, setQuickName] = useState('');

  // Manual form
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualDay1High, setManualDay1High] = useState('');
  const [manualExchange, setManualExchange] = useState('NSE');

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const resetForm = useCallback(() => {
    setQuickSymbol('');
    setQuickDate('');
    setQuickName('');
    setManualSymbol('');
    setManualName('');
    setManualDate('');
    setManualDay1High('');
    setManualExchange('NSE');
    setError('');
    setIsAdding(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  // Handle overlay click - only close when clicking the dark background
  const handleOverlayClick = useCallback((e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      handleClose();
    }
  }, [handleClose]);

  // Quick Add: just enter symbol + listing date, we fetch Day 1 data
  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!quickSymbol.trim() || !quickDate) {
      setError('Symbol and Listing Date are required');
      return;
    }
    setIsAdding(true);
    setError('');
    try {
      const result = await api.addStock({
        symbol: quickSymbol.trim().toUpperCase(),
        name: quickName.trim() || quickSymbol.trim().toUpperCase(),
        listingDate: quickDate,
        exchange: 'NSE'
      });
      if (result.success) {
        toast.success(`${quickSymbol.toUpperCase()} added!`, {
          style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(0,255,136,0.2)' }
        });
        onStockAdded?.();
        handleClose();
      } else {
        setError(result.error || result.message || 'Failed to add stock. Check symbol/date.');
      }
    } catch (err) {
      setError(err.message || 'Failed to add stock');
    }
    setIsAdding(false);
  };

  // Manual Add: user enters all OHLC data
  const handleManualAdd = async (e) => {
    e.preventDefault();
    if (!manualSymbol.trim() || !manualDay1High) {
      setError('Symbol and Day 1 High are required');
      return;
    }
    setIsAdding(true);
    setError('');
    try {
      const result = await api.addStockManual({
        symbol: manualSymbol.trim().toUpperCase(),
        name: manualName.trim() || manualSymbol.trim().toUpperCase(),
        listingDate: manualDate || new Date().toISOString().split('T')[0],
        day1High: manualDay1High,
        exchange: manualExchange
      });
      if (result.success) {
        toast.success(`${manualSymbol.toUpperCase()} added!`, {
          style: { background: '#1a1a2e', color: '#e0e0f0', border: '1px solid rgba(0,255,136,0.2)' }
        });
        onStockAdded?.();
        handleClose();
      } else {
        setError(result.error || result.message || 'Failed to add stock');
      }
    } catch (err) {
      setError(err.message || 'Failed to add stock');
    }
    setIsAdding(false);
  };

  // Stop keyboard events from propagating outside modal
  const stopPropagation = (e) => {
    e.stopPropagation();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} onKeyDown={stopPropagation}>
      <div className="modal-content" ref={modalRef} onClick={stopPropagation}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Plus className="w-5 h-5 text-[var(--color-neon-green)]" />
            Add IPO Stock
          </h2>
          <button 
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => { setMode('quick'); setError(''); }}
            className={`tab-btn flex-1 ${mode === 'quick' ? 'active' : ''}`}
            type="button"
          >
            <Search className="w-3.5 h-3.5 inline mr-1.5" />
            Quick Add
          </button>
          <button
            onClick={() => { setMode('manual'); setError(''); }}
            className={`tab-btn flex-1 ${mode === 'manual' ? 'active' : ''}`}
            type="button"
          >
            <Plus className="w-3.5 h-3.5 inline mr-1.5" />
            Manual Entry
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-neon-red)]/10 border border-[var(--color-neon-red)]/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-neon-red)] mt-0.5 shrink-0" />
            <span className="text-sm text-[var(--color-neon-red)]">{error}</span>
          </div>
        )}

        {mode === 'quick' ? (
          <form onSubmit={handleQuickAdd}>
            <p className="text-xs text-[var(--color-dark-300)] mb-4">
              Enter the NSE/BSE ticker symbol and listing date. Day 1 High will be auto-fetched from Yahoo Finance.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-dark-200)] mb-1.5">
                  Symbol * (NSE Ticker)
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  className="input-dark"
                  placeholder="e.g. ZOMATO, AMAGI, SHADOWFAX"
                  value={quickSymbol}
                  onChange={(e) => setQuickSymbol(e.target.value.toUpperCase())}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-dark-200)] mb-1.5">
                  Company Name (optional)
                </label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder="Company name"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-neon-green)] mb-1.5">
                  IPO Listing Date *
                </label>
                <input
                  type="date"
                  className="input-dark"
                  value={quickDate}
                  onChange={(e) => setQuickDate(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isAdding || !quickSymbol.trim() || !quickDate}
              className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching Day 1 Data & Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add Stock
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleManualAdd}>
            <p className="text-xs text-[var(--color-dark-300)] mb-4">
              Enter stock details manually if auto-fetch doesn't work.
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-dark-200)] mb-1.5">
                    Symbol *
                  </label>
                  <input
                    type="text"
                    className="input-dark"
                    placeholder="e.g. TCS"
                    value={manualSymbol}
                    onChange={(e) => setManualSymbol(e.target.value.toUpperCase())}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-dark-200)] mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    className="input-dark"
                    placeholder="Company name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-dark-200)] mb-1.5">
                    Listing Date
                  </label>
                  <input
                    type="date"
                    className="input-dark"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-dark-200)] mb-1.5">
                    Exchange
                  </label>
                  <select
                    className="input-dark"
                    value={manualExchange}
                    onChange={(e) => setManualExchange(e.target.value)}
                  >
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-neon-green)] mb-1.5">
                  Day 1 High * (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="input-dark"
                  placeholder="0.00"
                  value={manualDay1High}
                  onChange={(e) => setManualDay1High(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isAdding || !manualSymbol.trim() || !manualDay1High}
              className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add Stock
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default memo(AddStockModal);

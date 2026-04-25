const API_BASE = '/api';

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export const api = {
  // Stocks
  getStocks: () => request('/stocks'),
  searchStocks: (query) => request(`/stocks/search?q=${encodeURIComponent(query)}`),
  addStock: (data) => request('/stocks', { method: 'POST', body: JSON.stringify(data) }),
  addStockManual: (data) => request('/stocks/manual', { method: 'POST', body: JSON.stringify(data) }),
  removeStock: (symbol) => request(`/stocks/${symbol}`, { method: 'DELETE' }),
  toggleMonitoring: (symbol) => request(`/stocks/${symbol}/toggle`, { method: 'PATCH' }),
  resetBreakout: (symbol) => request(`/stocks/${symbol}/reset-breakout`, { method: 'PATCH' }),
  getQuote: (symbol) => request(`/stocks/${symbol}/quote`),
  getHistory: (symbol, start) => request(`/stocks/${symbol}/history?start=${start}`),
  
  // Breakouts
  getBreakouts: () => request('/breakouts'),
  clearBreakouts: () => request('/breakouts', { method: 'DELETE' }),
  
  // Stats
  getStats: () => request('/stats'),
  
  // Recent IPOs
  loadRecentIpos: () => request('/load-recent-ipos', { method: 'POST' }),
};

import { Router } from 'express';
import {
  getAllStocks,
  addStock,
  updateStockPrice,
  removeStock,
  toggleMonitoring,
  getAllBreakouts,
  clearBreakouts,
  resetBreakoutForStock,
  getStats,
  pruneWatchlist
} from '../services/dataStore.js';
import { getLiveQuote, getHistoricalData, getListingDayCandle, getSessionPrice, searchStock, getFirstTradeInfo } from '../services/yahooFinance.js';
import { validateExistingStocks } from '../services/ipoDiscovery.js';

const router = Router();

// ===== STOCK ROUTES =====

// Get all tracked stocks
// Query params:
//   ?all=true         → return every stock regardless of listing age
//   ?maxAgeDays=N     → only return stocks listed within the last N days (default: 365)
router.get('/stocks', (req, res) => {
  try {
    let stocks = getAllStocks();

    if (req.query.all !== 'true') {
      const maxAgeDays = parseInt(req.query.maxAgeDays, 10) || 365;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      stocks = stocks.filter(s => {
        if (!s.listingDate) return true; // keep if no date info
        return new Date(s.listingDate) >= cutoffDate;
      });
    }

    res.json({ success: true, stocks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search for stocks
router.get('/stocks/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
    const results = await searchStock(q);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new stock to track
router.post('/stocks', async (req, res) => {
  try {
    const { symbol, name, listingDate, exchange } = req.body;
    if (!symbol || !listingDate) {
      return res.status(400).json({ success: false, error: 'Symbol and listingDate are required' });
    }

    // Resolve the listing from Yahoo's own metadata rather than the supplied date.
    // This is the same source the discovery, validation and repair paths use, so a
    // manually added stock ends up with byte-identical Day 1 figures instead of a
    // candle picked off a different exchange.
    let listingInfo = null;
    try {
      listingInfo = await getFirstTradeInfo(symbol);
    } catch {
      return res.status(503).json({
        success: false,
        error: 'Could not reach Yahoo Finance. Please try again.'
      });
    }

    const day1Candle = listingInfo?.day1 ?? await getListingDayCandle(symbol, listingDate);

    if (!day1Candle) {
      return res.status(404).json({ 
        success: false, 
        error: 'Could not fetch listing day data. Please verify the symbol and listing date.' 
      });
    }

    // Get current live price
    const liveQuote = await getLiveQuote(symbol);
    
    const result = addStock({
      symbol,
      name: name || (liveQuote ? liveQuote.name : symbol),
      listingDate: listingInfo?.firstTradeDate || listingDate,
      day1High: day1Candle.high,
      day1Low: day1Candle.low,
      day1Open: day1Candle.open,
      day1Close: day1Candle.close,
      day1Volume: day1Candle.volume,
      yahooSymbol: listingInfo?.yahooSymbol ?? null,
      exchange: exchange || 'NSE'
    });

    // Seed the price straight away. The monitor only polls during market hours,
    // so without this a stock added after close shows a blank price until the
    // next session — and its breakout would not be evaluated until then either.
    if (result.success) {
      const seed = await getSessionPrice(symbol);
      if (seed) {
        const updated = updateStockPrice(result.stock.symbol, seed.price);
        if (updated) result.stock = updated.stock;
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add stock with manual Day 1 high
router.post('/stocks/manual', (req, res) => {
  try {
    const { symbol, name, listingDate, day1High, day1Open, day1Low, day1Close, exchange } = req.body;
    if (!symbol || !day1High) {
      return res.status(400).json({ success: false, error: 'Symbol and day1High are required' });
    }

    const result = addStock({
      symbol,
      name: name || symbol,
      listingDate: listingDate || new Date().toISOString().split('T')[0],
      day1High: parseFloat(day1High),
      day1Low: day1Low ? parseFloat(day1Low) : null,
      day1Open: day1Open ? parseFloat(day1Open) : null,
      day1Close: day1Close ? parseFloat(day1Close) : null,
      exchange: exchange || 'NSE'
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove a stock
router.delete('/stocks/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const removed = removeStock(symbol);
    res.json({ success: removed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle monitoring
router.patch('/stocks/:symbol/toggle', (req, res) => {
  try {
    const { symbol } = req.params;
    const stock = toggleMonitoring(symbol);
    res.json({ success: !!stock, stock });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset breakout for a stock
router.patch('/stocks/:symbol/reset-breakout', (req, res) => {
  try {
    const { symbol } = req.params;
    const stock = resetBreakoutForStock(symbol);
    res.json({ success: !!stock, stock });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get live quote for a specific stock
router.get('/stocks/:symbol/quote', async (req, res) => {
  try {
    const { symbol } = req.params;
    const quote = await getLiveQuote(symbol);
    res.json({ success: !!quote, quote });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get historical data
router.get('/stocks/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { start, end } = req.query;
    const data = await getHistoricalData(symbol, start || '2024-01-01', end);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== BREAKOUT ROUTES =====

router.get('/breakouts', (req, res) => {
  try {
    const breakouts = getAllBreakouts();
    res.json({ success: true, breakouts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/breakouts', (req, res) => {
  try {
    clearBreakouts();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== RETROACTIVE VALIDATION =====

router.post('/stocks/validate', async (req, res) => {
  try {
    const removed = await validateExistingStocks();
    res.json({ success: true, removed, count: removed.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== WATCHLIST PRUNE =====

router.post('/stocks/prune', (req, res) => {
  try {
    const pruned = pruneWatchlist();
    res.json({ success: true, pruned, count: pruned.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== STATS =====

router.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

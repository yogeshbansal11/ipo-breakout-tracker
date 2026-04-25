import express from 'express';
import { Router } from 'express';
import { RECENT_IPOS } from '../data/recentIpos.js';
import {
  getAllStocks,
  getStock,
  addStock,
  updateStockPrice,
  removeStock,
  toggleMonitoring,
  getAllBreakouts,
  clearBreakouts,
  resetBreakoutForStock,
  getStats
} from '../services/dataStore.js';
import {
  getLiveQuote,
  getHistoricalData,
  getListingDayCandle,
  searchStock
} from '../services/yahooFinance.js';

const router = Router();

// ===== STOCK ROUTES =====

// Get all tracked stocks
router.get('/stocks', (req, res) => {
  try {
    const stocks = getAllStocks();
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

    // Fetch Day 1 candle data
    const day1Candle = await getListingDayCandle(symbol, listingDate);
    
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
      listingDate,
      day1High: day1Candle.high,
      day1Low: day1Candle.low,
      day1Open: day1Candle.open,
      day1Close: day1Candle.close,
      day1Volume: day1Candle.volume,
      exchange: exchange || 'NSE'
    });

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

// ===== LOAD RECENT IPOS =====

router.post('/load-recent-ipos', async (req, res) => {
  try {
    const results = { added: [], skipped: [], failed: [] };

    for (const ipo of RECENT_IPOS) {
      // Skip if already tracked
      const existing = getStock(ipo.symbol);
      if (existing) {
        results.skipped.push(ipo.symbol);
        continue;
      }

      try {
        // Fetch Day 1 candle
        const day1Candle = await getListingDayCandle(ipo.symbol, ipo.listingDate);
        if (!day1Candle) {
          results.failed.push({ symbol: ipo.symbol, reason: 'No Day 1 data' });
          continue;
        }

        // Get current price to check if already broken out
        const liveQuote = await getLiveQuote(ipo.symbol);

        const addResult = addStock({
          symbol: ipo.symbol,
          name: (liveQuote && liveQuote.name) || ipo.name,
          listingDate: ipo.listingDate,
          day1High: day1Candle.high,
          day1Low: day1Candle.low,
          day1Open: day1Candle.open,
          day1Close: day1Candle.close,
          day1Volume: day1Candle.volume,
          exchange: ipo.exchange
        });

        if (addResult.success) {
          results.added.push(ipo.symbol);
          // Immediately check breakout if we have a live price
          if (liveQuote && liveQuote.price) {
            updateStockPrice(ipo.symbol, liveQuote.price);
          }
        }
      } catch (err) {
        results.failed.push({ symbol: ipo.symbol, reason: err.message });
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 800));
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent IPO list (without loading)
router.get('/recent-ipos', (req, res) => {
  res.json({ success: true, ipos: RECENT_IPOS });
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

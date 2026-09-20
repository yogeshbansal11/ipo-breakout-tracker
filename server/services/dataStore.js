import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data', 'ipo-stocks.json');

const SHORT_SLEEP = new Int32Array(new SharedArrayBuffer(4));

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Reads the watchlist.
 *
 * A missing file is a legitimate empty watchlist. A file that exists but does
 * not parse is NOT: every caller writes the object it just read straight back,
 * so answering a corrupt file with an empty watchlist erases it for good.
 * Throwing keeps the bad state on disk where it can still be recovered.
 */
function readData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return { stocks: [], breakouts: [], lastUpdated: null };
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Watchlist file is corrupt (${DATA_FILE}): ${error.message}`);
  }
}

/**
 * Writes the watchlist atomically.
 *
 * The price monitor rewrites this file every 10s while startup validation and
 * the cron prune read it. Writing in place lets a reader observe a half-written
 * file; staging to a temp file and renaming means every reader sees one
 * complete version or the other, never a torn one.
 */
function writeData(data) {
  ensureDataDir();
  data.lastUpdated = new Date().toISOString();
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));

  // Windows refuses to replace a file another handle still has open, so a read
  // that overlaps this rename surfaces as EPERM/EACCES/EBUSY. The reads are
  // short, so a brief retry clears it; without one the update is silently lost.
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.renameSync(tmp, DATA_FILE);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
        try { fs.unlinkSync(tmp); } catch { /* temp file already gone */ }
        throw error;
      }
      lastError = error;
      Atomics.wait(SHORT_SLEEP, 0, 0, 5); // writeData is sync; this blocks ~5ms
    }
  }

  try { fs.unlinkSync(tmp); } catch { /* temp file already gone */ }
  throw new Error(`Could not save watchlist after 20 attempts: ${lastError.message}`);
}

// ========== STOCKS ==========

export function getAllStocks() {
  const data = readData();
  return data.stocks;
}

export function getStock(symbol) {
  const data = readData();
  return data.stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
}

export function addStock(stock) {
  const data = readData();
  const exists = data.stocks.find(s => s.symbol.toUpperCase() === stock.symbol.toUpperCase());
  if (exists) {
    return { success: false, message: 'Stock already exists' };
  }
  
  const r2 = v => (v != null ? Math.round(v * 100) / 100 : null);

  const newStock = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    symbol: stock.symbol.toUpperCase(),
    name: stock.name || stock.symbol,
    listingDate: stock.listingDate,
    day1High: r2(stock.day1High),
    day1Low: r2(stock.day1Low),
    day1Open: r2(stock.day1Open),
    day1Close: r2(stock.day1Close),
    day1Volume: stock.day1Volume,
    currentPrice: null,
    breakoutTriggered: false,
    breakoutTimestamp: null,
    breakoutPrice: null,
    breakoutAttempts: 0,
    isMonitoring: true,
    addedAt: new Date().toISOString(),
    exchange: stock.exchange || 'NSE',
    // Which Yahoo ticker the data came from, so a stock's figures can be traced
    // back to one exchange rather than silently mixing NSE and BSE readings.
    yahooSymbol: stock.yahooSymbol ?? null
  };
  
  data.stocks.push(newStock);
  writeData(data);
  return { success: true, stock: newStock };
}

export function updateStockPrice(symbol, price) {
  const data = readData();
  const stock = data.stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (!stock) return null;
  
  // A breakout that failed re-arms once price falls back through the Day 1 Low —
  // the level a trade on it would have been stopped out at. Backtesting showed a
  // stock that reclaims its Day 1 High after failing is still a profitable entry
  // (176 trades vs 124, total +62R vs +46R), so the alert has to be able to fire
  // again rather than latching on the first attempt forever.
  const stoppedOut = stock.breakoutTriggered && stock.day1Low && price <= stock.day1Low;
  if (stoppedOut) {
    stock.breakoutTriggered = false;
    stock.breakoutTimestamp = null;
    stock.breakoutPrice = null;
  }

  // Breakout is a property of the stock's current state, not of the price ticking.
  // Evaluating it before the unchanged-price shortcut matters because a stock can
  // already sit above its Day 1 High the first time it is quoted, or have its Day 1
  // High corrected downward afterwards. In both cases the price may never change
  // again — with the check below the shortcut, the breakout would never fire.
  // Requires at least 0.5% above Day 1 High to ignore tick-level noise.
  const attempts = stock.breakoutAttempts ?? 0;
  const isBreakout = !stock.breakoutTriggered
    && attempts < MAX_BREAKOUT_ATTEMPTS
    && stock.day1High
    && price > stock.day1High * 1.005;

  // Skip write if nothing would change
  if (stock.currentPrice === price && !isBreakout && !stoppedOut) {
    return { stock, breakout: false };
  }

  stock.currentPrice = price;
  stock.lastPriceUpdate = new Date().toISOString();

  if (isBreakout) {
    stock.breakoutTriggered = true;
    stock.breakoutAttempts = attempts + 1;
    stock.breakoutTimestamp = new Date().toISOString();
    stock.breakoutPrice = price;
    
    // One record per symbol per breakout. Without this, any earlier record for the
    // same symbol would linger alongside the new one and inflate the breakout count.
    data.breakouts = (data.breakouts || []).filter(
      b => b.symbol.toUpperCase() !== stock.symbol.toUpperCase()
    );

    data.breakouts.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      symbol: stock.symbol,
      name: stock.name,
      day1High: stock.day1High,
      breakoutPrice: price,
      breakoutTimestamp: stock.breakoutTimestamp,
      percentAbove: (((price - stock.day1High) / stock.day1High) * 100).toFixed(2),
      attempt: stock.breakoutAttempts
    });
    
    writeData(data);
    return { stock, breakout: true };
  }
  
  writeData(data);
  return { stock, breakout: false };
}

export function removeStock(symbol) {
  const data = readData();
  const index = data.stocks.findIndex(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (index === -1) return false;
  data.stocks.splice(index, 1);
  // Drop the stock's breakout records too, otherwise they outlive the stock and
  // keep showing up on the Breakouts tab for something no longer tracked.
  data.breakouts = (data.breakouts || []).filter(
    b => b.symbol.toUpperCase() !== symbol.toUpperCase()
  );
  writeData(data);
  return true;
}

export function toggleMonitoring(symbol) {
  const data = readData();
  const stock = data.stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (!stock) return null;
  stock.isMonitoring = !stock.isMonitoring;
  writeData(data);
  return stock;
}

// ========== BREAKOUTS ==========

export function getAllBreakouts() {
  const data = readData();
  return data.breakouts;
}

export function clearBreakouts() {
  const data = readData();
  data.breakouts = [];
  writeData(data);
}

// ========== RESET ==========

export function resetBreakoutForStock(symbol) {
  const data = readData();
  const stock = data.stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (stock) {
    stock.breakoutTriggered = false;
    stock.breakoutTimestamp = null;
    stock.breakoutPrice = null;
    stock.breakoutAttempts = 0;
    writeData(data);
  }
  return stock;
}

// ========== WATCHLIST PRUNE ==========

/**
 * Watchlist criteria. A stock earns a place only while it is a *recent* listing
 * whose price is at or near its listing-day high — i.e. a live breakout candidate.
 */
export const MAX_LISTING_AGE_DAYS = 45;
export const NEAR_BAND_PCT = -5; // dashboard shows from 5% below the Day 1 High upwards

/** Distance from the Day 1 High as a percentage, or null without a price. */
export function distanceFromDay1HighPct(stock) {
  if (!stock.currentPrice || !stock.day1High) return null;
  return ((stock.currentPrice - stock.day1High) / stock.day1High) * 100;
}

/**
 * Whether a stock is close enough to its Day 1 High to be worth showing.
 * A display filter only — stocks outside the band stay tracked so they can be
 * picked up again if they climb back.
 */
export function isNearBreakout(stock) {
  const d = distanceFromDay1HighPct(stock);
  return d === null || d >= NEAR_BAND_PCT;
}

/**
 * Minimum Day 1 high-to-low range, as a % of the Day 1 Low.
 *
 * Backtested over 279 breakout trades from 2024-2026: IPOs whose first day
 * barely moved produced a 30% win rate at 1:2 and lost money, while those with a
 * >=10% first-day range won 46% and returned +0.38R. A flat first day makes the
 * Day 1 High a level nobody contested, so crossing it signals nothing. The edge
 * is a plateau rather than a spike — 10% and 12% score the same — and it held in
 * every listing year tested, so the boundary is not curve-fitted.
 */
export const MIN_DAY1_RANGE_PCT = 10;

/**
 * How many times one stock may signal a breakout. Backtesting found the second
 * attempt still profitable (38% win, +0.14R) and the third too thin to judge
 * (10 trades), so three is the cap — past that it is noise, not a setup.
 */
export const MAX_BREAKOUT_ATTEMPTS = 3;

/** Day 1 high-to-low range as a percentage, or null when Day 1 data is missing. */
export function day1RangePct(stock) {
  if (stock.day1High == null || !stock.day1Low) return null;
  return ((stock.day1High - stock.day1Low) / stock.day1Low) * 100;
}

/**
 * Removes stocks that are no longer breakout candidates:
 *  - Listed more than MAX_LISTING_AGE_DAYS ago  -> the listing-day high has gone stale
 *  - Day 1 range below MIN_DAY1_RANGE_PCT       -> flat first day, the level means nothing
 *
 * Both are safe to delete on: neither a listing date nor a Day 1 range can ever
 * change, so a stock removed by them could never have come back.
 *
 * Price distance is deliberately NOT a deletion rule. It reverses — a stock can
 * fall 6% below the Day 1 High and reclaim it a week later, which backtesting
 * showed is a profitable second entry. Deleting on price threw those away, and
 * because a deleted symbol is no longer "new" to discovery it could never be
 * re-added. Use isNearBreakout() to hide them from the dashboard instead.
 */
export function pruneWatchlist() {
  const data = readData();
  const today = new Date();
  const pruned = [];

  data.stocks = data.stocks.filter(stock => {
    const listingDate = stock.listingDate ? new Date(stock.listingDate) : null;
    const daysListed = listingDate
      ? Math.floor((today - listingDate) / (1000 * 60 * 60 * 24))
      : null;

    if (daysListed !== null && daysListed > MAX_LISTING_AGE_DAYS) {
      pruned.push({ symbol: stock.symbol, reason: `listed ${daysListed} days ago — older than ${MAX_LISTING_AGE_DAYS}d` });
      return false;
    }

    const rangePct = day1RangePct(stock);
    if (rangePct !== null && rangePct < MIN_DAY1_RANGE_PCT) {
      pruned.push({ symbol: stock.symbol, reason: `Day 1 range only ${rangePct.toFixed(1)}% — below the ${MIN_DAY1_RANGE_PCT}% minimum` });
      return false;
    }

    return true;
  });

  // Reconcile against every remaining stock rather than only this run's removals,
  // so records orphaned by earlier deletions get cleared out as well.
  const tracked = new Set(data.stocks.map(s => s.symbol.toUpperCase()));
  const breakouts = (data.breakouts || []).filter(b => tracked.has(b.symbol.toUpperCase()));
  const orphaned = (data.breakouts || []).length - breakouts.length;

  if (pruned.length > 0 || orphaned > 0) {
    data.breakouts = breakouts;
    writeData(data);
  }

  return pruned;
}

/**
 * Overwrites listingDate / Day 1 OHLC for a stock from its genuine listing-day
 * candle. Used to repair rows whose listing date was recorded as the discovery
 * date rather than the real one.
 */
export function repairListingData(symbol, listingDate, candle, yahooSymbol = null) {
  const data = readData();
  const stock = data.stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (!stock) return null;

  const r2 = v => (v != null ? Math.round(v * 100) / 100 : null);
  const changed = stock.listingDate !== listingDate
    || stock.day1High !== r2(candle.high)
    || (yahooSymbol != null && stock.yahooSymbol !== yahooSymbol);

  stock.listingDate = listingDate;
  stock.day1High = r2(candle.high);
  stock.day1Low = r2(candle.low);
  stock.day1Open = r2(candle.open);
  stock.day1Close = r2(candle.close);
  stock.day1Volume = candle.volume;
  if (yahooSymbol != null) stock.yahooSymbol = yahooSymbol;

  if (changed) writeData(data);
  return { stock, changed };
}

/**
 * Replaces the watchlist with one fetched from the authoritative source, used
 * by deployments that mirror rather than own the data.
 *
 * Two fields resist the overwrite, because this process observes them sooner
 * than the source does:
 *
 *  - currentPrice, when the local reading is the newer of the two. This process
 *    quotes every 10s; the source only every 10 minutes, so taking its price
 *    unconditionally would visibly rewind the dashboard on every sync.
 *  - breakoutTriggered once true. A breakout only ever flips on, so letting a
 *    not-yet-updated source clear it would flicker the badge off and back on
 *    within seconds of a live cross.
 */
export function mergeRemoteWatchlist(remote) {
  const data = readData();
  const local = new Map(data.stocks.map(s => [s.symbol.toUpperCase(), s]));

  data.stocks = (remote.stocks || []).map(incoming => {
    const mine = local.get(incoming.symbol.toUpperCase());
    if (!mine) return incoming;

    const merged = { ...incoming };

    const localIsNewer =
      mine.lastPriceUpdate &&
      (!incoming.lastPriceUpdate || mine.lastPriceUpdate > incoming.lastPriceUpdate);

    if (localIsNewer) {
      merged.currentPrice = mine.currentPrice;
      merged.lastPriceUpdate = mine.lastPriceUpdate;
    }

    if (mine.breakoutTriggered && !incoming.breakoutTriggered) {
      merged.breakoutTriggered = true;
      merged.breakoutTimestamp = mine.breakoutTimestamp;
      merged.breakoutPrice = mine.breakoutPrice;
    }

    return merged;
  });

  // Keep any locally observed breakout record the source has not caught up on.
  const tracked = new Set(data.stocks.filter(s => s.breakoutTriggered).map(s => s.symbol.toUpperCase()));
  const incomingBreakouts = remote.breakouts || [];
  const seen = new Set(incomingBreakouts.map(b => b.symbol.toUpperCase()));
  const localOnly = (data.breakouts || []).filter(
    b => tracked.has(b.symbol.toUpperCase()) && !seen.has(b.symbol.toUpperCase())
  );
  data.breakouts = [...incomingBreakouts, ...localOnly];

  writeData(data);
  return data.stocks.length;
}

// ========== STATS ==========

export function getStats() {
  const data = readData();
  return {
    totalStocks: data.stocks.length,
    monitoringCount: data.stocks.filter(s => s.isMonitoring).length,
    breakoutCount: data.breakouts.length,
    pendingBreakouts: data.stocks.filter(s => !s.breakoutTriggered && s.isMonitoring).length,
    lastUpdated: data.lastUpdated
  };
}

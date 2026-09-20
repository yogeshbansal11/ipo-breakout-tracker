import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addStock, getStock, getAllStocks, removeStock, repairListingData, MAX_LISTING_AGE_DAYS, MIN_DAY1_RANGE_PCT } from './dataStore.js';
import { getLiveQuote, getFirstTradeInfo } from './yahooFinance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWN_FILE = path.join(__dirname, '..', 'data', 'known-instruments.json');

// Keywords in name or symbol that indicate NON-IPO instruments
const NON_IPO_NAME_KEYWORDS = [
  'ETF', 'BEES', 'LIQUID', 'GSEC', 'BOND', 'GILT', 'NIFTY', 'SENSEX',
  'MUTUAL FUND', 'FUND', 'INDEX', 'CPSE', 'NAV', 'TBILL', 'BHARAT BOND',
  'GROWW', 'MIRAE', 'HSBC', 'NIPPON', 'SBI MF', 'HDFC MF', 'KOTAK MF',
  'AXIS MF', 'ICICI MF', 'DSP MF', 'MOTILAL', 'INVIT', 'REIT', 'TRUST'
];

// Exchange series suffixes that are not mainboard equity IPOs.
//   -SM / -ST  NSE and BSE SME boards (deliberately not tracked)
//   -SG / -GS  government securities
//   -N<digit>  debentures and bond series
// Screening these out early avoids thousands of pointless Yahoo lookups, and
// Yahoo has no usable data for them anyway.
const EXCLUDED_SERIES = /-(SM|ST|SG|GS|N\d+)$/i;

// Symbol-level patterns that are NOT IPOs
const NON_IPO_SYMBOL_PATTERNS = [
  EXCLUDED_SERIES,
  /NAV$/i,           // NAV tickers
  /^NIFTY/i,         // Nifty index instruments
  /^BANK10/i,        // Bank bonds/debentures
  /-P\d+$/i,         // Rights/Preference shares (e.g. TVSMNCRPS-P1)
  /RIIT/i,           // REIT instruments
  /INVIT/i,          // InvIT instruments
  /ETF$/i,           // ETFs
  /BEES$/i,          // Benchmark ETFs
  /GOLD$/i,          // Gold ETFs (unless an actual company)
  /SILVER$/i,        // Silver ETFs
];

function isLikelyIPO(symbol, name) {
  const upperName = (name || '').toUpperCase();
  const upperSymbol = (symbol || '').toUpperCase();

  // Check name keywords
  if (NON_IPO_NAME_KEYWORDS.some(kw => upperName.includes(kw))) {
    return false;
  }

  // Check symbol patterns
  if (NON_IPO_SYMBOL_PATTERNS.some(pattern => pattern.test(upperSymbol))) {
    return false;
  }

  return true;
}

function ensureDataDir() {
  const dir = path.dirname(KNOWN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getKnownInstruments() {
  ensureDataDir();
  try {
    if (fs.existsSync(KNOWN_FILE)) {
      return JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('Error reading known instruments:', error.message);
  }
  return [];
}

/**
 * Writes the baseline atomically, for the same reason the watchlist does: a
 * reader that catches this file mid-write parses nothing, getKnownInstruments
 * answers with an empty list, and discovery treats that as a first run — it
 * re-baselines and detects no IPOs that day.
 */
function saveKnownInstruments(symbols) {
  ensureDataDir();
  const tmp = `${KNOWN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(symbols, null, 2));
  fs.renameSync(tmp, KNOWN_FILE);
}

/**
 * Downloads latest instruments list, finds brand new ones,
 * checks if they are valid IPOs, and adds them.
 */
export async function runAutoIpoDiscovery() {
  console.log('🔍 Running Auto IPO Discovery...');
  try {
    const { data } = await axios.get('https://api.kite.trade/instruments');
    const lines = data.split('\n');
    
    // We care about NSE/BSE Equity symbols (filter out Futures, Options, Indices)
    // Kite format: instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
    const currentSymbols = new Set();
    const symbolMap = new Map();

    const skipKeywords = [
      'ETF', 'BEES', 'LIQUID', 'GSEC', 'BOND', 'GILT', 'NIFTY', 'SENSEX',
      'MUTUAL FUND', 'FUND', 'INDEX', 'CPSE', 'NAV', 'TBILL', 'GROWW',
      'MIRAE', 'HSBC', 'NIPPON', 'INVIT', 'REIT', 'TRUST'
    ];

    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 12) continue;
        const [,, tradingsymbol, name,,,,,, instrument_type, , exchange] = parts;

        // Keep only NSE Mainboard (EQ) — SME (SM) excluded (high capital requirement)
        if (
            (exchange === 'NSE' && instrument_type === 'EQ') ||
            (exchange === 'BSE' && instrument_type === 'E')
        ) {
            // Filter out obvious ETFs/Bonds from names to reduce noise
            const upperName = (name || '').toUpperCase();
            if (skipKeywords.some(kw => upperName.includes(kw))) continue;

            const cleanSymbol = tradingsymbol.trim().replace(/"/g, '');
            currentSymbols.add(cleanSymbol);
            
            if (!symbolMap.has(cleanSymbol)) {
                symbolMap.set(cleanSymbol, { name: name.replace(/"/g, '').trim(), exchange });
            }
        }
    }

    const currentArray = Array.from(currentSymbols);
    const knownArray = getKnownInstruments();
    
    if (knownArray.length === 0) {
      console.log(`📥 Initializing known instruments database with ${currentArray.length} symbols...`);
      saveKnownInstruments(currentArray);
      console.log('✅ Baseline created. New IPOs will be detected on tomorrow\'s run.');
      return;
    }

    const knownSet = new Set(knownArray);
    const newListings = currentArray.filter(sym => !knownSet.has(sym));

    console.log(`🔎 Scan complete. Found ${newListings.length} potential new listings today.`);

    if (newListings.length > 0) {
        let addedCount = 0;

        for (const symbol of newListings) {
            // Check if we already track this symbol manually
            if (getStock(symbol)) continue;

            // --- STRICT IPO FILTER ---
            // Reject ETFs, Mutual Funds, Indices, Bonds, REITs, Rights issues, etc.
            const instrumentInfo = symbolMap.get(symbol);
            if (!isLikelyIPO(symbol, instrumentInfo?.name)) {
                console.log(`⏭️ Skipping ${symbol} - not an IPO (filtered as non-equity instrument)`);
                continue;
            }

            // Fetch live quote from Yahoo Finance to confirm it's real and trading
            let quote = await getLiveQuote(symbol);
            if (!quote) continue; // Not found on Yahoo Finance yet (might take a day)

            // Double-check quote name for non-IPO keywords
            if (!isLikelyIPO(symbol, quote.name)) {
                console.log(`⏭️ Skipping ${symbol} (${quote.name}) - Yahoo confirms it's not an IPO stock`);
                continue;
            }
            
            // Establish the genuine listing date from chart metadata. Counting candles
            // is not enough: Yahoo answers for symbols it does not really cover with a
            // single synthetic candle, which reads as a one-day-old IPO. Only a real
            // firstTradeDate proves this is a new listing.
            const listingInfo = await getFirstTradeInfo(symbol);

            if (!listingInfo) {
                console.log(`⚠️ Skipping ${symbol} - no verifiable listing date on Yahoo Finance (unconfirmed instrument)`);
                continue;
            }

            const listingDateStr = listingInfo.firstTradeDate;
            const ageDays = Math.floor((Date.now() - new Date(listingDateStr)) / 86400000);

            if (ageDays > MAX_LISTING_AGE_DAYS) {
                console.log(`⚠️ Skipping ${symbol} - listed ${listingDateStr} (${ageDays}d ago), not a recent IPO`);
                continue;
            }

            const day1Candle = listingInfo.day1;
            const initialHigh = day1Candle ? day1Candle.high : null;

            if (!initialHigh) {
                console.log(`⚠️ Skipping ${symbol} - no listing-day candle available`);
                continue;
            }

            // Reject a flat first day up front rather than adding it for the prune to
            // delete minutes later. Backtested across 279 breakouts, sub-10% Day 1
            // ranges won 30% at 1:2 and lost money; wider ones won 46%.
            const day1Range = day1Candle.low
                ? ((initialHigh - day1Candle.low) / day1Candle.low) * 100
                : null;

            if (day1Range !== null && day1Range < MIN_DAY1_RANGE_PCT) {
                console.log(`⏭️ Skipping ${symbol} - Day 1 range only ${day1Range.toFixed(1)}% (need ${MIN_DAY1_RANGE_PCT}%)`);
                continue;
            }

            console.log(`🆕 ADDING AUTO-DETECTED IPO: ${symbol} (${quote.name})`);

            addStock({
                symbol: symbol,
                name: quote.name,
                listingDate: listingDateStr,
                day1High: initialHigh,
                yahooSymbol: listingInfo.yahooSymbol,
                day1Low: day1Candle ? day1Candle.low : quote.dayLow,
                day1Open: day1Candle ? day1Candle.open : quote.open,
                day1Close: day1Candle ? day1Candle.close : quote.previousClose,
                exchange: symbolMap.get(symbol)?.exchange || 'NSE'
            });
            addedCount++;
        }
        
        // Save the updated list back
        saveKnownInstruments(currentArray);
        console.log(`🎉 Auto Discovery finished. Successfully added ${addedCount} new IPO(s).`);
    }

  } catch (error) {
    console.error('❌ Auto IPO Discovery failed:', error.message);
  }
}

/**
 * Retroactively validates every stock already in the watchlist.
 *
 * A stock keeps its place only if Yahoo reports a genuine `firstTradeDate` that
 * falls inside the watchlist window. Two cases get removed:
 *
 *  - No firstTradeDate at all — Yahoo does not really cover the symbol, so the
 *    "listing" cannot be confirmed. Its single synthetic candle would otherwise
 *    masquerade as a one-day-old IPO.
 *  - A firstTradeDate older than MAX_LISTING_AGE_DAYS — an established company.
 */
export async function validateExistingStocks() {
  console.log('🔍 Retroactive validation: confirming listing dates against Yahoo Finance...');
  const stocks = getAllStocks();
  const removed = [];

  for (const stock of stocks) {
    try {
      const info = await getFirstTradeInfo(stock.symbol);

      if (!info) {
        console.log(`❌ UNVERIFIABLE: ${stock.symbol} (${stock.name}) — Yahoo has no listing date for this symbol`);
        removeStock(stock.symbol);
        removed.push({ symbol: stock.symbol, name: stock.name, reason: 'no verifiable listing date on Yahoo Finance' });
        continue;
      }

      const ageDays = Math.floor((Date.now() - new Date(info.firstTradeDate)) / 86400000);
      if (ageDays > MAX_LISTING_AGE_DAYS) {
        console.log(`❌ NOT AN IPO: ${stock.symbol} (${stock.name}) — trading since ${info.firstTradeDate} (${ageDays}d)`);
        removeStock(stock.symbol);
        removed.push({ symbol: stock.symbol, name: stock.name, reason: `trading since ${info.firstTradeDate} (${ageDays} days)` });
      }
    } catch {
      // Yahoo Finance error for this symbol — skip, don't remove
    }

    await new Promise(r => setTimeout(r, 600));
  }

  if (removed.length > 0) {
    console.log(`✅ Validation done. Removed ${removed.length} stock(s) that are not confirmed recent IPOs.`);
  } else {
    console.log('✅ Validation done. All stocks confirmed as genuine recent IPOs.');
  }

  return removed;
}

/**
 * Repairs listingDate / Day 1 OHLC for stocks whose listing date was recorded as
 * the discovery date rather than the real one.
 *
 * Runs after validation, so every remaining stock already has a confirmed
 * firstTradeDate; this just writes that date and its listing-day candle in.
 */
export async function repairListingDates() {
  console.log('🛠️  Repairing listing dates from confirmed listing-day candles...');
  const stocks = getAllStocks();
  const repaired = [];

  for (const stock of stocks) {
    try {
      const info = await getFirstTradeInfo(stock.symbol);
      if (!info?.day1?.high) continue;

      const result = repairListingData(stock.symbol, info.firstTradeDate, info.day1, info.yahooSymbol);
      if (result?.changed) {
        console.log(`   ↻ ${stock.symbol}: listing ${stock.listingDate} → ${info.firstTradeDate}, D1H ${stock.day1High} → ${result.stock.day1High}`);
        repaired.push({ symbol: stock.symbol, from: stock.listingDate, to: info.firstTradeDate });
      }
    } catch {
      // Yahoo Finance error for this symbol — leave its data untouched
    }

    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`✅ Listing-date repair done. Corrected ${repaired.length} stock(s).`);
  return repaired;
}

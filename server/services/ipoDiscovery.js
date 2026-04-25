import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addStock, getStock } from './dataStore.js';
import { getLiveQuote, getListingDayCandle, getHistoricalData } from './yahooFinance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWN_FILE = path.join(__dirname, '..', 'data', 'known-instruments.json');

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

function saveKnownInstruments(symbols) {
  ensureDataDir();
  fs.writeFileSync(KNOWN_FILE, JSON.stringify(symbols, null, 2));
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

    const skipKeywords = ['ETF', 'BEES', 'LIQUID', 'GSEC', 'BOND'];

    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 12) continue;
        const [,, tradingsymbol, name,,,,,, instrument_type, segment, exchange] = parts;

        // Keep Mainboard (EQ) and SME (SM) for NSE, and Equity (E) for BSE
        if (
            (exchange === 'NSE' && (instrument_type === 'EQ' || instrument_type === 'SM')) ||
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
        const todayStr = new Date().toISOString().split('T')[0];

        for (const symbol of newListings) {
            // Check if we already track this symbol manually
            if (getStock(symbol)) continue;

            // Fetch live quote from Yahoo Finance to confirm it's real and trading
            let quote = await getLiveQuote(symbol);
            if (!quote) continue; // Not found on Yahoo Finance yet (might take a day)
            
            // Check if it's a REAL new listing by looking for old trading history (30+ days ago)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 60);
            const pastStr = thirtyDaysAgo.toISOString().split('T')[0];
            const history = await getHistoricalData(symbol, pastStr, todayStr);
            
            // If it had a lot of trading days before today, it's NOT a new IPO (e.g. symbol change or exchange migration)
            if (history && history.length > 5) {
                console.log(`⚠️ Skipping ${symbol} - not a real IPO (found ${history.length} old candles)`);
                continue;
            }

            // Try to get day 1 candle (this also verifies if we have history data for day1High)
            const day1Candle = await getListingDayCandle(symbol, todayStr);
            const initialHigh = day1Candle ? day1Candle.high : quote.dayHigh;

            if (initialHigh) {
                console.log(`🆕 ADDING AUTO-DETECTED IPO: ${symbol} (${quote.name})`);
                
                addStock({
                    symbol: symbol,
                    name: quote.name,
                    listingDate: todayStr,
                    day1High: initialHigh,
                    day1Low: day1Candle ? day1Candle.low : quote.dayLow,
                    day1Open: day1Candle ? day1Candle.open : quote.open,
                    day1Close: day1Candle ? day1Candle.close : quote.previousClose,
                    exchange: symbolMap.get(symbol)?.exchange || 'NSE'
                });
                addedCount++;
            }
        }
        
        // Save the updated list back
        saveKnownInstruments(currentArray);
        console.log(`🎉 Auto Discovery finished. Successfully added ${addedCount} new IPO(s).`);
    }

  } catch (error) {
    console.error('❌ Auto IPO Discovery failed:', error.message);
  }
}

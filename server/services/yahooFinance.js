import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Build Yahoo Finance symbol variants for an Indian stock, in preference order.
 *
 * Kite uses suffixes like -SM (NSE SME), -BE (BSE), -BL (BSE illiquid), -N1 (NSE
 * settlement) that Yahoo does not recognise, so the stripped base symbol is tried
 * too. Order matters for every caller that takes the first match:
 *
 *  1. NSE before BSE. The same company can have a different listing day and a
 *     different Day 1 candle on each exchange — KARAMTARA read ₹352 on one and
 *     ₹378.20 on the other, enough to flip it either side of the Day 1 range
 *     filter. Pinning to NSE keeps every reading consistent.
 *  2. Base symbol before the suffixed one. Yahoo answers unknown suffixed tickers
 *     with a single synthetic candle instead of an error, which reads as a
 *     brand-new listing.
 */
function buildSymbolVariants(symbol) {
  if (symbol.includes('.')) return [symbol];
  const base = symbol.replace(/-SM$|-BE$|-BL$|-N1$/i, '');
  const variants = [`${base}.NS`];
  if (base !== symbol) variants.push(`${symbol}.NS`);
  variants.push(`${base}.BO`);
  if (base !== symbol) variants.push(`${symbol}.BO`);
  return variants;
}

/**
 * Get live quote for Indian stock - tries NSE (.NS) first, then BSE (.BO)
 */
export async function getLiveQuote(symbol) {
  const suffixes = buildSymbolVariants(symbol);
  
  for (const sym of suffixes) {
    try {
      const quote = await yahooFinance.quote(sym);
      if (quote && quote.regularMarketPrice) {
        return {
          symbol: symbol.replace('.NS', '').replace('.BO', ''),
          yahooSymbol: sym,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChange,
          changePercent: quote.regularMarketChangePercent,
          dayHigh: quote.regularMarketDayHigh,
          dayLow: quote.regularMarketDayLow,
          open: quote.regularMarketOpen,
          previousClose: quote.regularMarketPreviousClose,
          volume: quote.regularMarketVolume,
          marketState: quote.marketState,
          name: quote.shortName || quote.longName || symbol,
          exchange: quote.exchange,
          timestamp: new Date().toISOString()
        };
      }
    } catch {
      // Try next suffix
    }
  }
  console.error(`No quote found for ${symbol}`);
  return null;
}

/**
 * Get historical OHLC data using chart() API (historical() is deprecated in v3)
 */
export async function getHistoricalData(symbol, startDate, endDate) {
  const suffixes = buildSymbolVariants(symbol);

  // Probe EVERY variant and keep the richest series rather than returning the
  // first non-empty one. Yahoo does not recognise Kite suffixes (-SM, -BE, ...)
  // and answers those with a single stub candle instead of an error. Returning
  // early on that stub made established companies look like zero-history IPOs,
  // which is how non-IPOs ended up on the watchlist.
  let best = [];
  for (const sym of suffixes) {
    try {
      const result = await yahooFinance.chart(sym, {
        period1: startDate,
        period2: endDate || new Date().toISOString().split('T')[0],
        interval: '1d'
      });
      const quotes = result.quotes || [];
      if (quotes.length > best.length) {
        best = quotes;
      }
    } catch {
      // Try next suffix
    }
  }

  if (best.length === 0) {
    console.error(`Error fetching historical data for ${symbol}`);
    return [];
  }

  return best.map(candle => ({
    date: new Date(candle.date).toISOString().split('T')[0],
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));
}

/**
 * Get Day 1 (listing day) OHLC candle - uses chart() API, tries NSE then BSE
 */
export async function getListingDayCandle(symbol, listingDate) {
  const suffixes = buildSymbolVariants(symbol);
  const endDate = new Date(listingDate);
  endDate.setDate(endDate.getDate() + 5);
  const endStr = endDate.toISOString().split('T')[0];

  for (const sym of suffixes) {
    try {
      const result = await yahooFinance.chart(sym, {
        period1: listingDate,
        period2: endStr,
        interval: '1d'
      });

      if (result.quotes && result.quotes.length > 0) {
        const firstDay = result.quotes[0];
        console.log(`✅ Found Day 1 data for ${sym}`);
        return {
          date: new Date(firstDay.date).toISOString().split('T')[0],
          open: firstDay.open,
          high: firstDay.high,
          low: firstDay.low,
          close: firstDay.close,
          volume: firstDay.volume
        };
      }
    } catch (error) {
      console.log(`⚠️ No data for ${sym}: ${error.message}`);
    }
  }
  console.error(`❌ No listing day data found for ${symbol} on any exchange`);
  return null;
}

/**
 * Search for a stock by name or symbol
 */
export async function searchStock(query) {
  try {
    const result = await yahooFinance.search(query, {
      newsCount: 0,
      quotesCount: 10
    });
    return (result.quotes || [])
      .filter(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'NSE')
      .map(q => ({
        symbol: q.symbol.replace('.NS', '').replace('.BO', ''),
        yahooSymbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type: q.quoteType
      }));
  } catch (error) {
    console.error(`Error searching for ${query}:`, error.message);
    return [];
  }
}

/**
 * Get quotes for multiple symbols at once
 */
export async function getBulkQuotes(symbols) {
  const results = [];
  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5);
    const promises = batch.map(s => getLiveQuote(s));
    const batchResults = await Promise.allSettled(promises);
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }
    if (i + 5 < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return results;
}

/**
 * Resolves a symbol's genuine first trading day using chart metadata.
 *
 * `meta.firstTradeDate` is the only trustworthy listing signal Yahoo exposes.
 * For a symbol it does not really cover (most NSE SME tickers) it answers with
 * `firstTradeDate: null` plus a single synthetic candle built from the live
 * quote — which is indistinguishable from a genuine one-day-old IPO if you only
 * count candles. Returning null here lets callers reject the unverifiable case
 * instead of mistaking it for a brand new listing.
 *
 * Returns { firstTradeDate, yahooSymbol, day1 } or null when unverifiable.
 */
export async function getFirstTradeInfo(symbol) {
  const suffixes = buildSymbolVariants(symbol);
  let best = null;
  let answered = false;

  for (const sym of suffixes) {
    try {
      const result = await yahooFinance.chart(sym, {
        period1: '2000-01-01',
        period2: new Date().toISOString().split('T')[0],
        interval: '1d'
      });

      answered = true;
      const ftd = result.meta?.firstTradeDate;
      if (!ftd) continue; // synthetic/stub response — Yahoo does not cover this symbol

      const firstTradeDate = new Date(ftd).toISOString().split('T')[0];
      const quotes = (result.quotes || []).filter(c => c.high != null);
      const first = quotes[0];

      // Take the first variant that answers — the list is already in preference
      // order (NSE first). Picking "earliest listing date" instead would silently
      // switch exchanges and return a Day 1 candle that disagrees with every other
      // reading for the same stock. The listing date and the Day 1 OHLC always come
      // from this one response, so they can never be mixed across exchanges.
      best = {
        firstTradeDate,
        yahooSymbol: sym,
        day1: first
          ? {
              date: new Date(first.date).toISOString().split('T')[0],
              open: first.open, high: first.high,
              low: first.low, close: first.close, volume: first.volume
            }
          : null
      };
      break;
    } catch (error) {
      // A symbol Yahoo genuinely does not list is a real answer, not a failure.
      if (/No data found|may be delisted|Not Found/i.test(String(error?.message))) {
        answered = true;
      }
    }
  }

  // Never conflate "Yahoo is unreachable" with "this is not a listed stock".
  // Callers delete stocks on a null result, so a transient outage must throw
  // instead — otherwise a network blip silently wipes genuine IPOs.
  if (!best && !answered) {
    throw new Error(`Could not reach Yahoo Finance for ${symbol}`);
  }

  return best;
}

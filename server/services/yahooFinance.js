import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Get live quote for Indian stock - tries NSE (.NS) first, then BSE (.BO)
 */
export async function getLiveQuote(symbol) {
  const suffixes = symbol.includes('.') ? [symbol] : [`${symbol}.NS`, `${symbol}.BO`];
  
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
    } catch (error) {
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
  const suffixes = symbol.includes('.') ? [symbol] : [`${symbol}.NS`, `${symbol}.BO`];
  
  for (const sym of suffixes) {
    try {
      const result = await yahooFinance.chart(sym, {
        period1: startDate,
        period2: endDate || new Date().toISOString().split('T')[0],
        interval: '1d'
      });
      if (result.quotes && result.quotes.length > 0) {
        return result.quotes.map(candle => ({
          date: new Date(candle.date).toISOString().split('T')[0],
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        }));
      }
    } catch (error) {
      // Try next suffix
    }
  }
  console.error(`Error fetching historical data for ${symbol}`);
  return [];
}

/**
 * Get Day 1 (listing day) OHLC candle - uses chart() API, tries NSE then BSE
 */
export async function getListingDayCandle(symbol, listingDate) {
  const suffixes = symbol.includes('.') ? [symbol] : [`${symbol}.NS`, `${symbol}.BO`];
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

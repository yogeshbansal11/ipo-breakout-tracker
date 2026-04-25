import { getAllStocks, removeStock } from '../server/services/dataStore.js';
import { getHistoricalData } from '../server/services/yahooFinance.js';

async function cleanup() {
    console.log("Starting cleanup...");
    const stocks = getAllStocks();
    let removedCount = 0;

    for (const stock of stocks) {
        // If the stock's listing date is today or recent, let's verify if it actually has old history
        if (new Date() - new Date(stock.listingDate) < 1000 * 60 * 60 * 24 * 10) { // listed in last 10 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 40);
            const history = await getHistoricalData(stock.symbol, thirtyDaysAgo.toISOString().split('T')[0], stock.listingDate);
            
            if (history && history.length > 5) {
                console.log(`Removing ${stock.symbol} because it has ${history.length} old candles before its "listing" date.`);
                removeStock(stock.symbol);
                removedCount++;
            }
        }
    }
    console.log(`Cleanup complete. Removed ${removedCount} false IPOs.`);
}
cleanup();

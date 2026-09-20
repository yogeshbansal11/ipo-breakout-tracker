import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import apiRoutes from './routes/api.js';
import { getAllStocks, updateStockPrice, pruneWatchlist } from './services/dataStore.js';
import { getBulkQuotes } from './services/yahooFinance.js';
import cron from 'node-cron';
import { runAutoIpoDiscovery, validateExistingStocks, repairListingDates } from './services/ipoDiscovery.js';
import { sendBreakoutEmail } from './services/emailService.js';
import { config } from 'dotenv';
config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// An unmatched /api/* request must not fall through to the SPA handler below:
// it would answer index.html with status 200, so fetch() sees a successful
// response and then dies on "Unexpected token '<'" while parsing HTML as JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `No such API route: ${req.method} /api${req.url}` });
});

// Serve built frontend
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Create HTTP server and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected. Total: ${clients.size}`);
  
  // Send initial data. readData throws on a corrupt watchlist rather than
  // silently reporting it as empty, and an exception raised inside a 'connection'
  // listener is uncaught — it would take the whole server down on a browser
  // refresh. Report it to this client and leave the process running.
  try {
    ws.send(JSON.stringify({
      type: 'INIT',
      stocks: getAllStocks(),
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Could not send initial stocks:', error.message);
    ws.send(JSON.stringify({ type: 'ERROR', error: error.message }));
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    clients.delete(ws);
  });
});

// Broadcast to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  }
}

// ===== PRICE MONITORING ENGINE =====

/**
 * NSE/BSE trade Mon-Fri, 09:15-15:30 IST. Outside that window prices cannot
 * move, so polling every 10s burns roughly 8,600 pointless Yahoo requests a day
 * and risks being rate-limited exactly when the market reopens. Exchange
 * holidays are not modelled — the weekday and time window removes the bulk of
 * the waste, and a holiday just costs a day of no-op quotes.
 *
 * Read in Asia/Kolkata explicitly: the deploy target runs on UTC.
 */
function isMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = type => parts.find(p => p.type === type)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  // hour12:false can render midnight as "24" depending on the ICU build.
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

let monitoringInterval = null;
let isMonitoring = false;
let loggedMarketClosed = false;

async function monitorPrices(force = false) {
  if (isMonitoring) return;

  if (!force && !isMarketOpen()) {
    if (!loggedMarketClosed) {
      console.log('😴 Market closed (NSE trades Mon-Fri 09:15-15:30 IST) — pausing price polling.');
      loggedMarketClosed = true;
    }
    return;
  }
  loggedMarketClosed = false;

  isMonitoring = true;

  try {
    const stocks = getAllStocks();
    // Keep quoting stocks that have already broken out. Excluding them froze the
    // price of exactly the stocks worth watching most — the ones a trade is open
    // on — so the dashboard showed a stale number for the rest of the session.
    // updateStockPrice already refuses to fire a second breakout for the same stock.
    const activeStocks = stocks.filter(s => s.isMonitoring);
    
    if (activeStocks.length === 0) {
      isMonitoring = false;
      return;
    }

    console.log(`[${new Date().toLocaleTimeString()}] Monitoring ${activeStocks.length} stocks...`);

    const symbols = activeStocks.map(s => s.symbol);
    const quotes = await getBulkQuotes(symbols);

    const updates = [];
    const breakouts = [];

    for (const quote of quotes) {
      if (!quote || !quote.price) continue;
      
      const result = updateStockPrice(quote.symbol, quote.price);
      if (result) {
        updates.push({
          symbol: quote.symbol,
          name: quote.name,
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          day1High: result.stock.day1High,
          breakoutTriggered: result.stock.breakoutTriggered,
          marketState: quote.marketState
        });

        if (result.breakout) {
          console.log(`🚀 BREAKOUT! ${quote.symbol} crossed Day 1 High of ₹${result.stock.day1High} at ₹${quote.price}`);
          breakouts.push({
            symbol: quote.symbol,
            name: quote.name,
            price: quote.price,
            day1High: result.stock.day1High,
            percentAbove: (((quote.price - result.stock.day1High) / result.stock.day1High) * 100).toFixed(2),
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Broadcast price updates
    if (updates.length > 0) {
      broadcast({
        type: 'PRICE_UPDATE',
        updates,
        timestamp: new Date().toISOString()
      });
    }

    // Broadcast breakout alerts + send email
    if (breakouts.length > 0) {
      broadcast({
        type: 'BREAKOUT_ALERT',
        breakouts,
        timestamp: new Date().toISOString()
      });
      sendBreakoutEmail(breakouts).catch(err => console.error('Email send failed:', err.message));
    }

    // Send updated stock list only when prices actually changed
    if (updates.length > 0) {
      const allStocks = getAllStocks();
      broadcast({
        type: 'STOCKS_UPDATE',
        stocks: allStocks,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error in price monitoring:', error.message);
  }

  isMonitoring = false;
}

// Start monitoring every 10 seconds 
function startMonitoring() {
  console.log('📊 Starting price monitoring (every 10 seconds)...');
  monitorPrices(true); // Initial run — take one reading even if the market is shut
  monitoringInterval = setInterval(monitorPrices, 10000);
}

// Stop monitoring
function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log('⏹️ Price monitoring stopped');
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     🚀 IPO Breakout Tracker Server              ║
║     Running on http://localhost:${PORT}             ║
║     WebSocket on ws://localhost:${PORT}              ║
╚══════════════════════════════════════════════════╝
  `);
  startMonitoring();

  // Run auto discovery on startup (wait 5s for successful start)
  setTimeout(() => { runAutoIpoDiscovery(); }, 5000);

  // Clean up the watchlist once at startup. Order matters: drop false positives
  // first, then correct listing dates, then prune — pruning keys off the listing
  // date, so it has to see the repaired value.
  setTimeout(async () => {
    try {
      await validateExistingStocks();
      await repairListingDates();

      const pruned = pruneWatchlist();
      if (pruned.length > 0) {
        console.log(`🗑️  Pruned ${pruned.length} stock(s) from watchlist:`);
        pruned.forEach(p => console.log(`   - ${p.symbol}: ${p.reason}`));
      }

      broadcast({ type: 'STOCKS_UPDATE', stocks: getAllStocks(), timestamp: new Date().toISOString() });
    } catch (error) {
      // An unhandled rejection here would terminate the process on boot.
      console.error('❌ Startup watchlist cleanup failed:', error.message);
    }
  }, 8000);

  // Schedule auto discovery + prune daily at 9:05 AM India Time
  cron.schedule('0 9 * * *', () => {
    console.log('⏰ Running scheduled daily IPO discovery...');
    runAutoIpoDiscovery();
  }, { timezone: "Asia/Kolkata" });

  cron.schedule('5 9 * * *', async () => {
    console.log('✂️  Running scheduled daily watchlist prune...');
    try {
      await repairListingDates();
      const pruned = pruneWatchlist();
      if (pruned.length > 0) {
        console.log(`🗑️  Pruned ${pruned.length} stock(s):`);
        pruned.forEach(p => console.log(`   - ${p.symbol}: ${p.reason}`));
      }
      broadcast({ type: 'STOCKS_UPDATE', stocks: getAllStocks(), timestamp: new Date().toISOString() });
    } catch (error) {
      // Rejecting here would be an unhandled rejection, which is fatal in Node.
      console.error('❌ Daily prune failed:', error.message);
    }
  }, { timezone: "Asia/Kolkata" });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  stopMonitoring();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopMonitoring();
  server.close();
  process.exit(0);
});

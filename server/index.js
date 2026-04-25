import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import apiRoutes from './routes/api.js';
import { getAllStocks, updateStockPrice } from './services/dataStore.js';
import { getLiveQuote, getBulkQuotes } from './services/yahooFinance.js';
import cron from 'node-cron';
import { runAutoIpoDiscovery } from './services/ipoDiscovery.js';
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
  
  // Send initial data
  const stocks = getAllStocks();
  ws.send(JSON.stringify({ 
    type: 'INIT', 
    stocks,
    timestamp: new Date().toISOString() 
  }));

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
let monitoringInterval = null;
let isMonitoring = false;

async function monitorPrices() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    const stocks = getAllStocks();
    const activeStocks = stocks.filter(s => s.isMonitoring && !s.breakoutTriggered);
    
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
  monitorPrices(); // Initial run
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

  // Schedule auto discovery to run Daily at 9:00 AM India Time
  cron.schedule('0 9 * * *', () => {
    console.log('⏰ Running scheduled daily IPO discovery...');
    runAutoIpoDiscovery();
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

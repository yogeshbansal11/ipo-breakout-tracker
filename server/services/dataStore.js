import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data', 'ipo-stocks.json');

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readData() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error('Error reading data file:', error.message);
  }
  return { stocks: [], breakouts: [], lastUpdated: null };
}

function writeData(data) {
  ensureDataDir();
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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
  
  const newStock = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    symbol: stock.symbol.toUpperCase(),
    name: stock.name || stock.symbol,
    listingDate: stock.listingDate,
    day1High: stock.day1High,
    day1Low: stock.day1Low,
    day1Open: stock.day1Open,
    day1Close: stock.day1Close,
    day1Volume: stock.day1Volume,
    currentPrice: null,
    breakoutTriggered: false,
    breakoutTimestamp: null,
    breakoutPrice: null,
    isMonitoring: true,
    addedAt: new Date().toISOString(),
    exchange: stock.exchange || 'NSE'
  };
  
  data.stocks.push(newStock);
  writeData(data);
  return { success: true, stock: newStock };
}

export function updateStockPrice(symbol, price) {
  const data = readData();
  const stock = data.stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
  if (!stock) return null;
  
  // Skip write if price hasn't changed
  if (stock.currentPrice === price) {
    return { stock, breakout: false };
  }

  stock.currentPrice = price;
  stock.lastPriceUpdate = new Date().toISOString();
  
  // Check breakout condition
  if (!stock.breakoutTriggered && stock.day1High && price > stock.day1High) {
    stock.breakoutTriggered = true;
    stock.breakoutTimestamp = new Date().toISOString();
    stock.breakoutPrice = price;
    
    // Add to breakouts list
    data.breakouts.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      symbol: stock.symbol,
      name: stock.name,
      day1High: stock.day1High,
      breakoutPrice: price,
      breakoutTimestamp: stock.breakoutTimestamp,
      percentAbove: (((price - stock.day1High) / stock.day1High) * 100).toFixed(2)
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
    writeData(data);
  }
  return stock;
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

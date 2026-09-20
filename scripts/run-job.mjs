/**
 * One-shot runner for GitHub Actions.
 *
 * The Express server in server/index.js is a long-lived process: it polls every
 * 10s and keeps cron timers alive. A scheduled runner cannot work that way — it
 * boots, does one unit of work, and exits. This script performs exactly the same
 * work using exactly the same services, so both paths apply identical rules.
 *
 * Modes:
 *   check  — quote the watchlist, record breakouts, email them   (every 10 min)
 *   daily  — discover new IPOs, then validate / repair / prune    (once a day)
 *
 * Pass --force to ignore the market-hours gate (useful for a manual test run).
 */
import { config } from 'dotenv';
config({ quiet: true });

import { getAllStocks, updateStockPrice, pruneWatchlist } from '../server/services/dataStore.js';
import { getBulkQuotes } from '../server/services/yahooFinance.js';
import { sendBreakoutEmail } from '../server/services/emailService.js';
import { runAutoIpoDiscovery, validateExistingStocks, repairListingDates } from '../server/services/ipoDiscovery.js';
import { isMarketOpen } from '../server/services/marketHours.js';

const mode = process.argv[2] || 'check';
const force = process.argv.includes('--force');

const ist = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

/**
 * A breakout is recorded once and never re-fires, so an unconfigured mailbox
 * would consume the only alert you were going to get: the stock would be
 * flagged as broken out and no mail would ever be sent for it. Refuse to look
 * at prices at all until the mailbox is set up, leaving the watchlist untouched.
 */
function assertEmailConfigured() {
  const missing = ['EMAIL_USER', 'EMAIL_PASS', 'ALERT_EMAIL'].filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Email is not configured (missing ${missing.join(', ')}). ` +
      'Add them as GitHub repository secrets, or to .env when running locally. ' +
      'Refusing to check prices, because a breakout found now could never be emailed.'
    );
  }
}

async function runCheck() {
  assertEmailConfigured();

  if (!force && !isMarketOpen()) {
    console.log(`😴 Market closed at ${ist()} IST — nothing to check.`);
    return;
  }

  const watching = getAllStocks().filter(s => s.isMonitoring && !s.breakoutTriggered);
  if (watching.length === 0) {
    console.log('📭 No stocks are pending a breakout.');
    return;
  }

  console.log(`📊 Checking ${watching.length} stock(s) at ${ist()} IST...`);
  const quotes = await getBulkQuotes(watching.map(s => s.symbol));

  const breakouts = [];
  for (const quote of quotes) {
    if (!quote?.price) continue;
    const result = updateStockPrice(quote.symbol, quote.price);
    if (!result) continue;

    const distance = ((quote.price - result.stock.day1High) / result.stock.day1High) * 100;
    console.log(`   ${quote.symbol.padEnd(14)} ₹${quote.price}  (D1H ₹${result.stock.day1High}, ${distance.toFixed(2)}%)`);

    if (result.breakout) {
      console.log(`   🚀 BREAKOUT: ${quote.symbol} crossed ₹${result.stock.day1High}`);
      breakouts.push({
        symbol: quote.symbol,
        name: quote.name,
        price: quote.price,
        day1High: result.stock.day1High,
        percentAbove: distance.toFixed(2),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (breakouts.length === 0) {
    console.log('✅ No breakouts this run.');
    return;
  }

  // A failed email must not hide the fact that a breakout was recorded, and the
  // breakout is already saved either way — so report loudly and fail the run so
  // it shows up as a red cross rather than passing silently.
  try {
    await sendBreakoutEmail(breakouts);
  } catch (error) {
    console.error(`❌ Breakout detected but the email failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function runDaily() {
  console.log(`🌅 Daily maintenance at ${ist()} IST`);
  await runAutoIpoDiscovery();
  await validateExistingStocks();
  await repairListingDates();

  const pruned = pruneWatchlist();
  if (pruned.length > 0) {
    console.log(`🗑️  Pruned ${pruned.length} stock(s):`);
    pruned.forEach(p => console.log(`   - ${p.symbol}: ${p.reason}`));
  }

  const left = getAllStocks();
  console.log(`📋 Watchlist now holds ${left.length} stock(s): ${left.map(s => s.symbol).join(', ') || '(none)'}`);
}

try {
  if (mode === 'check') await runCheck();
  else if (mode === 'daily') await runDaily();
  else {
    console.error(`Unknown mode "${mode}". Use "check" or "daily".`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('❌ Job failed:', error.message);
  process.exitCode = 1;
}

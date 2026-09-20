import { mergeRemoteWatchlist } from './dataStore.js';

/**
 * Keeps a read-only deployment in step with the watchlist GitHub owns.
 *
 * Free hosting gives the app an ephemeral disk: every restart resets it to
 * whatever was committed at deploy time. On its own that means the dashboard
 * silently freezes — IPOs discovered later never appear, pruned ones never
 * leave — while still looking perfectly healthy.
 *
 * The scheduled GitHub job is the single writer of watchlist membership, so
 * this process re-reads its output instead of maintaining its own.
 */
const SOURCE_URL =
  'https://raw.githubusercontent.com/yogeshbansal11/ipo-breakout-tracker/main/server/data/ipo-stocks.json';

/**
 * True when running on a host whose disk does not survive a restart, so this
 * process must mirror rather than own the data. Render sets RENDER itself —
 * nothing has to be configured by hand.
 */
export const isMirror = process.env.RENDER === 'true' || process.env.MIRROR_MODE === 'true';

export async function syncFromSource() {
  try {
    // Bypass the CDN's 5-minute cache, or a sync can return what we already have.
    const response = await fetch(`${SOURCE_URL}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`⚠️  Watchlist sync failed: GitHub answered ${response.status}`);
      return null;
    }

    const remote = await response.json();
    if (!Array.isArray(remote?.stocks)) {
      console.error('⚠️  Watchlist sync failed: unexpected payload shape');
      return null;
    }

    const count = mergeRemoteWatchlist(remote);
    console.log(`🔄 Watchlist synced from GitHub — ${count} stock(s).`);
    return count;
  } catch (error) {
    // A failed sync is not fatal: the previous watchlist stays in place and the
    // next attempt picks up whatever changed.
    console.error('⚠️  Watchlist sync failed:', error.message);
    return null;
  }
}

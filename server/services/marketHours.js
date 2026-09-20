/**
 * NSE/BSE trade Mon-Fri, 09:15-15:30 IST. Outside that window prices cannot
 * move, so there is nothing for a price check to find.
 *
 * Exchange holidays are not modelled — the weekday and time window removes the
 * bulk of the waste, and a holiday just costs a run of no-op quotes.
 *
 * Read in Asia/Kolkata explicitly: both the deploy target and GitHub Actions
 * runners are on UTC.
 */
export function isMarketOpen(now = new Date()) {
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

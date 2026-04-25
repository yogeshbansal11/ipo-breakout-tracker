import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendBreakoutEmail(breakouts) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_USER === 'your_gmail@gmail.com') {
    console.warn('⚠️  Email not configured — skipping email alert. Set EMAIL_USER and EMAIL_PASS in .env');
    return;
  }

  const rows = breakouts.map(b => `
    <tr>
      <td style="padding:8px 12px;font-weight:bold">${b.symbol}</td>
      <td style="padding:8px 12px">${b.name || '-'}</td>
      <td style="padding:8px 12px">₹${b.price}</td>
      <td style="padding:8px 12px">₹${b.day1High}</td>
      <td style="padding:8px 12px;color:#16a34a;font-weight:bold">+${b.percentAbove}%</td>
      <td style="padding:8px 12px;color:#6b7280;font-size:12px">${new Date(b.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#dc2626">🚀 IPO Breakout Alert${breakouts.length > 1 ? 's' : ''}</h2>
      <p style="color:#374151">${breakouts.length} stock${breakouts.length > 1 ? 's have' : ' has'} broken out above Day 1 High:</p>
      <table style="border-collapse:collapse;width:100%;background:#f9fafb;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#1e293b;color:#fff">
            <th style="padding:10px 12px;text-align:left">Symbol</th>
            <th style="padding:10px 12px;text-align:left">Name</th>
            <th style="padding:10px 12px;text-align:left">Current Price</th>
            <th style="padding:10px 12px;text-align:left">Day 1 High</th>
            <th style="padding:10px 12px;text-align:left">% Above</th>
            <th style="padding:10px 12px;text-align:left">Time (IST)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px">Sent by IPO Breakout Tracker</p>
    </div>
  `;

  const subject = breakouts.length === 1
    ? `🚀 Breakout: ${breakouts[0].symbol} crossed Day 1 High (+${breakouts[0].percentAbove}%)`
    : `🚀 ${breakouts.length} Breakouts Detected`;

  await transporter.sendMail({
    from: `"IPO Breakout Tracker" <${process.env.EMAIL_USER}>`,
    to: process.env.ALERT_EMAIL,
    subject,
    html,
  });

  console.log(`📧 Breakout email sent to ${process.env.ALERT_EMAIL} for: ${breakouts.map(b => b.symbol).join(', ')}`);
}

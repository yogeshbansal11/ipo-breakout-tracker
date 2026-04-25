import axios from 'axios';
import fs from 'fs';

async function test() {
  const { data } = await axios.get('https://api.kite.trade/instruments');
  const lines = data.split('\n');
  const allSymbols = lines
    .filter(l => l.includes(',NSE') && l.includes(',EQ,'))
    .map(l => l.split(',')[2]); // tradingsymbol is index 2
    
  console.log(`Total NSE EQ symbols: ${allSymbols.length}`);
  // Let's pretend "GAUDIUMIVF" is a new IPO we didn't know about yesterday.
  const oldSymbols = allSymbols.filter(s => s !== 'GAUDIUMIVF');
  
  const newSymbols = allSymbols.filter(s => !oldSymbols.includes(s));
  console.log('Newly detected IPOs:', newSymbols);
}

test().catch(console.error);

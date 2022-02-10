import { PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';

async function main() {
  const mangoAccountPubkey = new PublicKey(process.env.MANGO_ACCOUNT as string);
  // const response = await fetch(
  //   `https://mango-transaction-log.herokuapp.com/v3/stats/account-performance-detailed-by-perp-market?mango-account=${mangoAccountPubkey.toString()}`,
  // );
  const response = await fetch(
    `https://mango-transaction-log.herokuapp.com/v3/stats/account-performance-detailed?mango-account=${mangoAccountPubkey.toString()}`,
  );

  const data = await response.json();
  const keys = Object.keys(data).sort();
  const lastKey = keys[keys.length - 1];
  console.log(lastKey, data[lastKey]);
}

main();

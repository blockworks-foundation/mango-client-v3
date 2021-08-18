/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Account, PublicKey, Connection } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import * as Test from './utils';
import { MangoClient } from '../src';
import { QUOTE_INDEX } from '../src/layout';

describe('Oracles', async () => {
  let client: MangoClient;
  let payer: Account;
  const connection: Connection = Test.createDevnetConnection();

  before(async () => {
    client = new MangoClient(connection, Test.MangoProgramId);
    payer = await Test.createAccount(connection, 10);
  });

  describe('MNGO', async () => {
    it('should read correct MNGO price', async () => {
      const mangoGroup = await client.getMangoGroup(new PublicKey('By6uwEKG88t8Mi1N478AP9CpiLsawyZNLRgyNwpHA6ua'));
      await client.cachePrices(
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        mangoGroup.oracles,
        payer,
      );
      const cache = await mangoGroup.loadCache(connection);
      for (let price of cache.priceCache) {
        console.log(price.price.toString());
      }
    });
  });
});

/**
This will probably move to its own repo at some point but easier to keep it here for now
This will be a long running program that will call all the Keeper related instructions on-chain

This will be very similar to the crank in serum dex.

 */
import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { sleep } from './utils';

export class Keeper {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = 5000;
    // eslint-disable-next-line
    while (true) {
      await sleep(interval);
      // TODO: Fetch ids from ids.json
      // TODO: Get cluster and keypair from env
      const merpsProgramId = new PublicKey(
        '8XywrZebqGoRTYgK1zLoESRdPx6gviRQe6hMonQZbt7M',
      );
      // const dexProgramId = new PublicKey(
      //   'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
      // );
      const merpsGroupKey = new PublicKey(
        'kLeipzWY2EqG9jFAiPmT2szU6evrQtce9CLDBccBWgo',
      );
      const payer = new Account(
        JSON.parse(
          fs.readFileSync(
            os.homedir() + '/.config/solana/devnet.json',
            'utf-8',
          ),
        ),
      );
      const connection = new Connection(
        'https://api.devnet.solana.com',
        'processed' as Commitment,
      );
      const client = new MerpsClient(connection, merpsProgramId);
      const merpsGroup = await client.getMerpsGroup(merpsGroupKey);

      await client.cacheRootBanks(
        merpsGroup.publicKey,
        merpsGroup.merpsCache,
        [],
        payer
      );

      const rootBanks = await merpsGroup.loadRootBanks(connection);
      rootBanks.forEach(async (rootBank) => {
        if (rootBank) {
          await client.updateRootBank(
            merpsGroup.publicKey,
            rootBank.publicKey,
            rootBank.nodeBanks.slice(0, rootBank.numNodeBanks),
            payer,
          );
        }
      });
    }
  }
}

new Keeper().run();

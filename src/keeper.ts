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
import { Config } from './config';

export class Keeper {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = 5000;
    // eslint-disable-next-line
    while (true) {
      const config = Config.ids().getGroup('devnet', 'merps_test_v1');
      await sleep(interval);
      // TODO: Get cluster and keypair from env
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
      const client = new MerpsClient(connection, config.merps_program_id);
      const merpsGroup = await client.getMerpsGroup(config.key);

      await client.cacheRootBanks(
        merpsGroup.publicKey,
        merpsGroup.merpsCache,
        [],
        payer,
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

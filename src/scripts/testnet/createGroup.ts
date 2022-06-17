/**
 * Creates a testnet group testnet.0, minting tokens if necessary, writers to ids.json
 */
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as os from 'os';
import * as fs from 'fs';
import { Config, IDS, MangoClient, sleep, zeroKey } from '../..';

import FIXED_IDS from './mints.json';

const cluster = 'testnet';
const keypairPath = os.homedir() + '/.config/solana/devnet.json';
const newGroupName = 'testnet.2';
const mangoProgramId = 'BXhdkETgbHrr5QmVBT1xbz3JrMM28u5djbVtmTUfmFTH';
const serumProgramId = '3qx9WcNPw4jj3v1kJbWoxSN2ZAakwUXFu9HDr2QjQ6xq';

async function createMintAndAirdrop(connection: Connection, payer: Keypair, decimals = 6, amount = 1000): Promise<Token> {
  const token = await Token.createMint(connection, payer, payer.publicKey, null, decimals, TOKEN_PROGRAM_ID);
  const account = await token
    .getOrCreateAssociatedAccountInfo(payer.publicKey)
    .then((a) => a.address);
  await token.mintTo(account, payer, [], amount);
  return token;
}

const initNewGroup = async () => {
  // const mints = IDS.filter((id) => id.symbol !== 'USDC').map((id) => id.mint);
  console.log('starting');
  const ids = FIXED_IDS[cluster];

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        process.env.KEYPAIR ||
          fs.readFileSync(
            os.homedir() + '/.config/solana/devnet.json',
            'utf-8',
          ),
      ),
    ),
  );
  const connection = new Connection('https://api.testnet.solana.com', 'processed');

  let quoteInfo = ids.find((id) => id.symbol === 'USDC')!;
  let quoteToken: Token;
  if(!quoteInfo.mint) {
    console.log(`creating USDC mint`);
    quoteToken = await createMintAndAirdrop(connection, payer, quoteInfo.decimals, 1_000_000);
  } else {
    quoteToken = new Token(connection, new PublicKey(quoteInfo.mint), TOKEN_PROGRAM_ID, payer);
  }
  const quoteMint = quoteToken.publicKey;
  const feesVault = await quoteToken
    .getOrCreateAssociatedAccountInfo(payer.publicKey)
    .then((a) => a.address);

  let groupIds = new Config(IDS).getGroup(cluster, newGroupName);

  if(!groupIds) {
    await execCommand(
      `yarn cli init-group ${newGroupName} ${mangoProgramId} ${serumProgramId} ${quoteMint.toBase58()} ${feesVault.toBase58()}`,
    );
    await sleep(1000);
    console.log(`new group initialized`);
    groupIds = new Config(IDS).getGroup(cluster, newGroupName)!;
  }

  const client = new MangoClient(connection, new PublicKey(mangoProgramId));
  const newGroup = await client.getMangoGroup(groupIds.publicKey)

  for (let i = 0; i < ids.length; i++) {
    const fids = ids[i];
    if (fids.symbol === 'USDC') {
      continue;
    }

    if (!fids.mint) {
      const token = await createMintAndAirdrop(connection, payer, fids.decimals, 1000);
      console.log(fids.symbol, token.publicKey.toBase58());
      fids.mint = token.publicKey.toBase58();
    }

    if(!newGroup.oracles[i - 1] || newGroup.oracles[i - 1].equals(zeroKey)) {
      console.log(`adding ${fids.symbol} oracle`);
      if (fids['price']) {
        await execCommand(`yarn cli add-oracle ${newGroupName} ${fids.symbol}`);
        await execCommand(
          `yarn cli set-oracle ${newGroupName} ${fids.symbol} ${fids['price']}`,
        );
      } else {
        await execCommand(
          `yarn cli add-oracle ${newGroupName} ${fids.symbol} --provider ${fids.oracleProvider}`,
        );
      }
      await sleep(2500);
    }

    if (newGroup.spotMarkets[i - 1].isEmpty()) {
      console.log(`listing and adding ${fids.symbol} spot market`);
      await execCommand(
        `yarn cli add-spot-market ${newGroupName} ${fids.symbol} ${
          fids.mint
        } --base_lot_size ${
          fids.baseLot
        } --quote_lot_size ${
          fids.quoteLot
        } --init_leverage ${
          fids.initLeverage || 5
        } --maint_leverage ${
          fids.maintLeverage || 10
        } --liquidation_fee ${fids.liquidationFee || 0.05}`,
      );
    }

    if (newGroup.perpMarkets[i - 1].isEmpty() && ['BTC', 'ETH', 'SOL', 'LUNA', 'AVAX', 'SRM', 'FTT', 'BNB', 'RAY', 'ADA', 'MNGO', 'GMT'].includes(fids.symbol)) {
      console.log(`adding ${fids.symbol} perp market`);
      await execCommand(
        `yarn cli add-perp-market ${newGroupName} ${
          fids.symbol
        } --init_leverage ${
          fids.initLeveragePerp || 5
        } --maint_leverage ${
          fids.maintLeveragePerp || 10
        } --liquidation_fee ${
          fids.liquidationFeePerp || 0.05
        } --base_lot_size ${fids.baseLot} --quote_lot_size ${fids.quoteLot}`,
      );
    }
    console.log('---');
  }
  console.log('Succcessfully created new mango group.');
};

function execCommand(cmd) {
  const exec = require('child_process').exec;
  cmd = cmd + ` --cluster ${cluster} --keypair ${keypairPath}`;

  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      console.log(stdout);
      //console.log('!!!!!!', error, stdout, stderr)
      if (error) {
        console.warn(error);
        reject(error);
      }
      resolve(stdout ? stdout : stderr);
    });
  });
}

initNewGroup();

/**
 * Create and fund various keypairs and mango accounts for testnet, writes to ./accounts.json
 */

import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BN,
  Config,
  IDS,
  makeCreateMangoAccountInstruction,
  makeDepositInstruction,
  MangoClient,
  QUOTE_INDEX,
  sleep,
  uiToNative,
} from '../..';

const createAccounts = async () => {
  const out: any[] = [];
  const accountsToCreate = 1;

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
  const connection = new Connection(
    'https://api.testnet.solana.com',
    'processed',
  );
  const ids = new Config(IDS).getGroup('testnet', 'testnet.0')!;
  const client = new MangoClient(connection, ids.mangoProgramId);
  const group = await client.getMangoGroup(ids.publicKey);

  const usdcInfo = ids.tokens[0];
    
    const usdcVaultPk = (await group.loadRootBanks(connection))[QUOTE_INDEX]!
      .nodeBankAccounts[0].vault;
    const usdcToken = new Token(
      connection,
      new PublicKey(usdcInfo.mintKey),
      TOKEN_PROGRAM_ID,
      payer,
    );
    const usdcWalletKey = await usdcToken
      .getOrCreateAssociatedAccountInfo(payer.publicKey)
      .then((a) => a.address);

  // create 500 accounts and deposit
  for (let i = 0; i < accountsToCreate; i++) {
    const info = {};
    console.log(`Creating account ${i + 1}/${accountsToCreate}...`)
    // Generate new keypair and sent 0.5 SOL, create a mango account
    const keypair = new Keypair();
    info['publicKey'] = keypair.publicKey.toBase58();
    info['secretKey'] = Array.from(keypair.secretKey);
    const transferLamportsIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: keypair.publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    });
    const accountNumber = new BN(1);
    const [mangoAccountPk] = await PublicKey.findProgramAddress(
      [
        ids.publicKey.toBytes(),
        keypair.publicKey.toBytes(),
        accountNumber.toBuffer('le', 8),
      ],
      ids.mangoProgramId,
    );
    info['mangoAccountPks'] = [ mangoAccountPk.toBase58() ];
    const createMangoAccountIx = makeCreateMangoAccountInstruction(
      ids.mangoProgramId,
      ids.publicKey,
      mangoAccountPk,
      keypair.publicKey,
      accountNumber,
      payer.publicKey,
    );

    // Deposit 10 USDC from payer on behalf of the new keypair
    const depositUsdcIx = makeDepositInstruction(
      ids.mangoProgramId,
      ids.publicKey,
      payer.publicKey,
      group.mangoCache,
      mangoAccountPk,
      usdcInfo.rootKey,
      usdcInfo.nodeKeys[0],
      usdcVaultPk,
      usdcWalletKey,
      uiToNative(10, usdcInfo.decimals),
    );

    const createAccountTx = new Transaction()
      .add(transferLamportsIx)
      .add(createMangoAccountIx)
      .add(depositUsdcIx);

    // hang until it's done
    let done = false;
    const sig = await connection.sendTransaction(createAccountTx, [payer, keypair], { skipPreflight: true });
    connection.onSignature(
      sig,
      (res) => {
        done = true;

        if (res.err) {
          console.error('err', sig, res.err.toString());
        } else {
          console.error('confirmed', sig);
        }
      },
      'confirmed',
    );

    while (!done) {
      await sleep(500);
    }

    out.push(info);
  }

  fs.writeFileSync(path.resolve(__dirname, 'accounts.json'), JSON.stringify(out));
};

function writeSecretYaml(
  name: string,
  app: string,
  cluster: string,
  keypair: Keypair,
  mangoAccount: PublicKey | undefined = undefined,
) {
  const secretKey = btoa(JSON.stringify(keypair.secretKey));
  const mangoAccountKey = mangoAccount
    ? `ACCOUNT_KEY=${mangoAccount.toBase58()}`
    : '';
  const config = `apiVersion: v1
kind: Secret
metadata:
    namespace: mango
    name: ${name}
    labels:
    app: ${app}
    cluster: ${cluster}
type: Opaque
data:
    SECRET_KEY: "${secretKey}"
    ${mangoAccountKey}`;

  fs.writeFileSync(
    path.resolve(__dirname, 'k8s', 'Secrets', name + '.toml'),
    config,
  );
}

createAccounts();

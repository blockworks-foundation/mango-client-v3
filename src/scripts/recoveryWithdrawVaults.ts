import { Market } from '@project-serum/serum';
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import {
  makeRecoveryWithdrawInsuranceVaultInstruction,
  makeRecoveryWithdrawMngoVaultInstruction,
  makeRecoveryWithdrawTokenVaultInstruction,
} from '../instruction';
import { QUOTE_INDEX, TokenAccountLayout } from '../layout';
import { TokenAccount } from '../utils/token';
import { nativeToUi, promiseNull, ZERO_BN } from '../utils/utils';
import * as fs from 'fs';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
const config = Config.ids();
const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const connection = new Connection(
  config.cluster_urls[cluster],
  'confirmed' as Commitment,
);

const groupName = process.env.GROUP || 'devnet.2';
const groupIds = config.getGroup(cluster, groupName)!;

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

const payer = Keypair.fromSecretKey(
  new Uint8Array(
    JSON.parse(
      fs.readFileSync('/Users/riordan/.config/solana/devnet.json', 'utf-8'),
    ),
  ),
);

const recoveryAuthorityPk = new PublicKey('8pANRWCcw8vn8DszUP7hh4xFbCiBiMWX3WbwUTipArSJ');
//const recoveryAuthorityPk = new PublicKey('9mM6NfXauEFviFY1S1thbo7HXYNiSWSvwZEhguJw26wY');

async function recoverFunds() {
  const group = await client.getMangoGroup(mangoGroupKey);
  await group.loadRootBanks(connection);
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((m) => {
      return group.loadPerpMarket(
        connection,
        m.marketIndex,
        m.baseDecimals,
        m.quoteDecimals,
      );
    }),
  );
  
  // Withdraw from eaxh token vault
  for (let rootBank of group.rootBankAccounts) {
    if (!rootBank) continue;
    const tx = new Transaction();
    // Find or create ATA
    const tokenInfo = groupIds.tokens.find((t) => t.rootKey.equals(rootBank!.publicKey))!;
    const tokenAccountPk =
    await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenInfo.mintKey,
      recoveryAuthorityPk,
    );
    const tokenAccountInfo =
      await connection.getAccountInfo(tokenAccountPk);
    if (!tokenAccountInfo) {
      console.log('creating ATA for mint' + tokenInfo.mintKey.toBase58());
      tx.add(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          tokenInfo.mintKey,
          tokenAccountPk,
          recoveryAuthorityPk,
          payer.publicKey,
        ),
      );
    }

    tx.add(
      makeRecoveryWithdrawTokenVaultInstruction(
        groupIds.mangoProgramId,
        group.publicKey,
        group.signerKey,
        rootBank.publicKey,
        rootBank.nodeBanks[0],
        rootBank.nodeBankAccounts[0].vault,
        tokenAccountPk,
      ),
    );
    //await client.sendTransaction(tx, payer, []);
  }

  // Withdraw all MNGO
  for (let market of perpMarkets) {
    const tx = new Transaction();
    tx.add(
      makeRecoveryWithdrawMngoVaultInstruction(
        groupIds.mangoProgramId,
        group.publicKey,
        group.signerKey,
        market.publicKey,
        market.mngoVault,
        new PublicKey('qkqNxh8L88P2eHEvCovKGkejgcvi5kC8xrSk8MkijHy'),
      ),
    );
    await client.sendTransaction(tx, payer, []);
  }

  const tx = new Transaction();
  // Withdraw Insurance Fund
  tx.add(makeRecoveryWithdrawInsuranceVaultInstruction(
    groupIds.mangoProgramId,
    group.publicKey,
    group.signerKey,
    group.insuranceVault,
    new PublicKey('E1gzGpcKNeEbCYe5rBeeUpeUujLE3zHKWMY4aUbHAuRN'),
  ));
  await client.sendTransaction(tx, payer, []);
}

recoverFunds();

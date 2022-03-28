import fs from 'fs';
import os from 'os';
import {
  Cluster,
  Config,
  MangoClient,
  MAX_PAIRS,
  sleep,
  throwUndefined,
  MAX_NUM_IN_MARGIN_BASKET,
  QUOTE_INDEX,
  I80F48,
} from '../src';
import configFile from '../src/ids.json';
import { Keypair, Commitment, Connection } from '@solana/web3.js';
import { Market } from '@project-serum/serum';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';

async function testSocializedLoss() {
  // Load all the details for mango group
  const groupName = process.env.GROUP || 'devnet.3';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 500;
  const config = new Config(configFile);
  const groupIds = config.getGroup(cluster, groupName);

  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;
  const payer = new Keypair(
    JSON.parse(
      process.env.KEYPAIR ||
        fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  );
  const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  const client = new MangoClient(connection, mangoProgramId);
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  let rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error();
  }
  const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);

  const liqor = await client.initMangoAccount(mangoGroup, payer);
  console.log('Created Liqor:', liqor.toBase58());
  await sleep(sleepTime);
  const liqorAccount = await client.getMangoAccount(
    liqor,
    mangoGroup.dexProgramId,
  );
  const tokenConfig = groupIds.tokens[QUOTE_INDEX];
  const tokenInfo = mangoGroup.tokens[QUOTE_INDEX];
  const token = new Token(connection, tokenInfo.mint, TOKEN_PROGRAM_ID, payer);
  const wallet = await token.getOrCreateAssociatedAccountInfo(payer.publicKey);

  await client.deposit(
    mangoGroup,
    liqorAccount,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    wallet.address,
    1000,
  );

  await liqorAccount.reload(connection);
  console.log('LIQOR', liqorAccount.publicKey.toBase58());

  const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
  await sleep(sleepTime);
  let mangoAccount = await client.getMangoAccount(
    mangoAccountPk,
    mangoGroup.dexProgramId,
  );
  console.log('Created Liqee:', mangoAccountPk.toBase58());

  const cache = await mangoGroup.loadCache(connection);
  // deposit
  await sleep(sleepTime / 2);

  const rayTokenConfig = groupIds.tokens[6];
  const tokenIndex = mangoGroup.getTokenIndex(rayTokenConfig.mintKey);
  const rootBank = throwUndefined(rootBanks[tokenIndex]);
  const rayTokenInfo = mangoGroup.tokens[tokenIndex];
  console.log(rayTokenConfig.symbol);
  const rayToken = new Token(
    connection,
    rayTokenInfo.mint,
    TOKEN_PROGRAM_ID,
    payer,
  );
  const rayWallet = await rayToken.getOrCreateAssociatedAccountInfo(
    payer.publicKey,
  );

  await sleep(sleepTime / 2);
  const banks = await rootBank.loadNodeBanks(connection);

  await sleep(sleepTime);

  console.log('Resetting oracle');
  await client.setStubOracle(mangoGroupKey, mangoGroup.oracles[5], payer, 10);
  console.log('Depositing');
  await client.deposit(
    mangoGroup,
    mangoAccount,
    payer,
    rootBank.publicKey,
    banks[0].publicKey,
    banks[0].vault,
    rayWallet.address,
    10,
  );
  await sleep(1000);
  await mangoAccount.reload(connection, mangoGroup.dexProgramId);
  console.log(
    'Liqee Value',
    mangoAccount.getAssetsVal(mangoGroup, cache, 'Init').toString(),
  );
  console.log(mangoAccount.toPrettyString(groupIds, mangoGroup, cache));
  console.log('withdrawing');
  await client.withdraw(
    mangoGroup,
    mangoAccount,
    payer,
    quoteRootBank.publicKey,
    quoteRootBank.nodeBanks[0],
    quoteNodeBanks[0].vault,
    10,
    true,
  );

  await mangoAccount.reload(connection);
  console.log(
    'Liqee Health:',
    mangoAccount.getHealth(mangoGroup, cache, 'Maint').toString(),
  );
  console.log('LIQEE', mangoAccount.publicKey.toBase58());

  await client.setStubOracle(mangoGroupKey, mangoGroup.oracles[5], payer, 0.5);

  rootBanks = await mangoGroup.loadRootBanks(connection);
  let assetRootBank = rootBanks[5];
  let liabRootBank = rootBanks[QUOTE_INDEX];
  if (!liabRootBank || !assetRootBank) {
    throw new Error('Root Banks not found');
  }
  const liabAmount = mangoAccount.getNativeBorrow(liabRootBank, QUOTE_INDEX);

  await sleep(1000);

  rootBanks = await mangoGroup.loadRootBanks(connection);
  assetRootBank = rootBanks[5];
  liabRootBank = rootBanks[QUOTE_INDEX];
  if (!liabRootBank || !assetRootBank) {
    throw new Error('Root Banks not found');
  }

  const preLiqQuoteDeposits = quoteRootBank.getNativeTotalDeposit();
  console.log('PreLiq', preLiqQuoteDeposits.toString());

  console.log('Liquidating');
  await client.liquidateTokenAndToken(
    mangoGroup,
    mangoAccount,
    liqorAccount,
    assetRootBank,
    liabRootBank,
    payer,
    I80F48.fromNumber(Math.abs(liabAmount.toNumber())),
  );
  await mangoAccount.reload(connection, mangoGroup.dexProgramId);
  await sleep(1000);

  rootBanks = await mangoGroup.loadRootBanks(connection);
  assetRootBank = rootBanks[5];
  liabRootBank = rootBanks[QUOTE_INDEX];
  if (!liabRootBank || !assetRootBank) {
    throw new Error('Root Banks not found');
  }

  const preLossQuoteDeposits = liabRootBank.getNativeTotalDeposit();
  console.log('Pre', preLossQuoteDeposits.toString());

  if (mangoAccount.isBankrupt) {
    console.log('resolveTokenBankruptcy');
    await client.resolveTokenBankruptcy(
      mangoGroup,
      mangoAccount,
      liqorAccount,
      quoteRootBank,
      liabRootBank,
      payer,
      I80F48.fromNumber(
        Math.abs(
          mangoAccount.getNativeBorrow(liabRootBank, QUOTE_INDEX).toNumber(),
        ),
      ),
    );
  } else {
    console.log('Account was not bankrupt');
  }
  await sleep(5000);

  rootBanks = await mangoGroup.loadRootBanks(connection);
  assetRootBank = rootBanks[5];
  liabRootBank = rootBanks[QUOTE_INDEX];
  if (!liabRootBank || !assetRootBank) {
    throw new Error('Root Banks not found');
  }

  const postLossQuoteDeposits = liabRootBank.getNativeTotalDeposit();
  console.log('Post', postLossQuoteDeposits.toString());

  console.log(
    'Diff',
    preLossQuoteDeposits.sub(postLossQuoteDeposits).toString(),
  );
}

testSocializedLoss();

import BN from 'bn.js';
import {
  DexInstructions,
  Market,
  TokenInstructions,
} from '@project-serum/serum';
import { TOKEN_PROGRAM_ID, Token, u64 } from '@solana/spl-token';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import { StubOracleLayout } from '../src/layout';
import { createAccountInstruction, sleep, ZERO_BN } from '../src/utils/utils';
import { msrmMints, MangoClient, I80F48 } from '../src';
import MangoGroup from '../src/MangoGroup';
import MangoAccount from '../src/MangoAccount';

export const MangoProgramId = new PublicKey(
  '5fP7Z7a87ZEVsKr2tQPApdtq83GcTW4kz919R6ou5h5E',
);
export const DexProgramId = new PublicKey(
  'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
);
export const USDCMint = new PublicKey(
  'H6hy7Ykzc43EuGivv7VVuUKNpKgUoFAfUY3wdPr4UyRX',
);
export const FeesVault = new PublicKey(
  '54PcMYTAZd8uRaYyb3Cwgctcfc1LchGMaqVrmxgr3yVs',
);
export const MSRMMint = msrmMints['devnet'];
const FAUCET_PROGRAM_ID = new PublicKey(
  '4bXpkKSV8swHSnwqtzuboGPaPDeEgAn4Vt8GfarV5rZt',
);

export const OPTIMAL_UTIL = 0.7;
export const OPTIMAL_RATE = 0.06;
export const MAX_RATE = 1.5;

const getPDA = () => {
  return PublicKey.findProgramAddress(
    [Buffer.from('faucet')],
    FAUCET_PROGRAM_ID,
  );
};

export async function _sendTransaction(
  connection: Connection,
  transaction: Transaction,
  signers: Account[],
): Promise<TransactionSignature> {
  await sleep(1000);
  const signature = await connection.sendTransaction(transaction, signers);
  try {
    await connection.confirmTransaction(signature);
  } catch (e) {
    console.info('Error while confirming, trying again');
    await connection.confirmTransaction(signature);
  }
  return signature;
}

export function createDevnetConnection() {
  return new Connection(
    'https://api.devnet.solana.com',
    'processed' as Commitment,
  );
}

export async function airdropSol(
  connection: Connection,
  account: Account,
  amount: number,
): Promise<void> {
  const roundedSolAmount = Math.round(amount);
  console.info(`Requesting ${roundedSolAmount} SOL`);
  const generousAccount = [
    115, 98, 128, 18, 66, 112, 147, 244, 46, 244, 118, 106, 91, 202, 56, 83, 58,
    71, 89, 226, 32, 177, 177, 240, 189, 23, 209, 176, 138, 119, 130, 140, 6,
    149, 55, 70, 215, 34, 108, 133, 225, 117, 38, 141, 74, 246, 232, 76, 176,
    10, 207, 221, 68, 179, 115, 158, 106, 133, 35, 30, 4, 177, 124, 5,
  ];
  const backupAcc = new Account(generousAccount);
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: backupAcc.publicKey,
      lamports: roundedSolAmount * 1e9,
      toPubkey: account.publicKey,
    }),
  );
  const signers = [backupAcc];
  const signerPks = signers.map((x) => x.publicKey);
  tx.setSigners(...signerPks);
  await _sendTransaction(connection, tx, signers);
}

export async function createOracle(
  connection: Connection,
  programId: PublicKey,
  payer: Account,
): Promise<PublicKey> {
  const createOracleIns = await createAccountInstruction(
    connection,
    payer.publicKey,
    StubOracleLayout.span,
    programId,
  );
  const tx = new Transaction();
  tx.add(createOracleIns.instruction);

  const signers = [payer, createOracleIns.account];
  const signerPks = signers.map((x) => x.publicKey);
  tx.setSigners(...signerPks);
  await _sendTransaction(connection, tx, signers);
  return createOracleIns.account.publicKey;
}

export async function createAccount(
  connection: Connection,
  solBalance = 5,
): Promise<Account> {
  const account = new Account();
  if (solBalance >= 1) {
    await airdropSol(connection, account, solBalance);
  }
  return account;
}

export async function createTokenAccountWithBalance(
  connection: Connection,
  owner: Account,
  tokenMint: PublicKey,
  tokenDecimals: number,
  faucetId: PublicKey,
  amount: number,
) {
  const multiplier = Math.pow(10, tokenDecimals);
  const processedAmount = amount * multiplier;
  let ownedTokenAccountPk: PublicKey | null = null;
  ownedTokenAccountPk = await createTokenAccount(connection, tokenMint, owner);
  if (amount > 0) {
    await airdropTokens(
      connection,
      owner,
      faucetId,
      ownedTokenAccountPk,
      tokenMint,
      new u64(processedAmount),
    );
  }
  return ownedTokenAccountPk;
}

export async function airdropTokens(
  connection: Connection,
  feePayerAccount: Account,
  faucetPubkey: PublicKey,
  tokenDestinationPublicKey: PublicKey,
  mint: PublicKey,
  amount: u64,
) {
  const ix = await buildAirdropTokensIx(
    amount,
    mint,
    tokenDestinationPublicKey,
    faucetPubkey,
  );
  const tx = new Transaction();
  tx.add(ix);
  const signers = [feePayerAccount];
  await _sendTransaction(connection, tx, signers);
  return tokenDestinationPublicKey.toBase58();
}

export async function buildAirdropTokensIx(
  amount: u64,
  tokenMintPublicKey: PublicKey,
  destinationAccountPubkey: PublicKey,
  faucetPubkey: PublicKey,
) {
  const pubkeyNonce = await getPDA();
  const keys = [
    { pubkey: pubkeyNonce[0], isSigner: false, isWritable: false },
    { pubkey: tokenMintPublicKey, isSigner: false, isWritable: true },
    { pubkey: destinationAccountPubkey, isSigner: false, isWritable: true },
    {
      pubkey: TokenInstructions.TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: faucetPubkey, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: FAUCET_PROGRAM_ID,
    data: Buffer.from([1, ...amount.toArray('le', 8)]),
    keys,
  });
}

export async function createTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: Account,
): Promise<PublicKey> {
  const newAccount = new Account();
  const tx = new Transaction();
  const signers = [owner, newAccount];
  const signerPks = signers.map((x) => x.publicKey);
  tx.add(
    ...(await createTokenAccountInstrs(
      connection,
      newAccount.publicKey,
      mint,
      owner.publicKey,
    )),
  );
  tx.setSigners(...signerPks);
  await _sendTransaction(connection, tx, signers);
  return newAccount.publicKey;
}

export async function createTokenAccountInstrs(
  connection: Connection,
  newAccountPubkey: PublicKey,
  mint: PublicKey,
  ownerPk: PublicKey,
  lamports?: number,
): Promise<TransactionInstruction[]> {
  if (lamports === undefined)
    lamports = await connection.getMinimumBalanceForRentExemption(165);
  return [
    SystemProgram.createAccount({
      fromPubkey: ownerPk,
      newAccountPubkey,
      space: 165,
      lamports,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: newAccountPubkey,
      mint,
      owner: ownerPk,
    }),
  ];
}

export async function createMint(
  connection: Connection,
  payer: Account,
  decimals: number,
): Promise<Token> {
  // const mintAuthority = Keypair.generate().publicKey; If needed can use a diff mint auth
  return await Token.createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    decimals,
    TOKEN_PROGRAM_ID,
  );
}

export async function createMints(
  connection: Connection,
  payer: Account,
  quantity: number,
): Promise<Token[]> {
  const mints: Token[] = [];
  for (let i = 0; i < quantity; i++) {
    const decimals = 6;
    mints.push(await createMint(connection, payer, decimals));
  }
  return mints;
}

export async function listMarket(
  connection: Connection,
  payer: Account,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseLotSize: number,
  quoteLotSize: number,
  dexProgramId: PublicKey,
): Promise<PublicKey> {
  const market = new Account();
  const requestQueue = new Account();
  const eventQueue = new Account();
  const bids = new Account();
  const asks = new Account();
  const baseVault = new Account();
  const quoteVault = new Account();
  const feeRateBps = 0;
  const quoteDustThreshold = new BN(100);

  async function getVaultOwnerAndNonce() {
    const nonce = ZERO_BN;
    // eslint-disable-next-line
    while (true) {
      try {
        const vaultOwner = await PublicKey.createProgramAddress(
          [market.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
          dexProgramId,
        );
        return [vaultOwner, nonce];
      } catch (e) {
        nonce.iaddn(1);
      }
    }
  }
  const [vaultOwner, vaultSignerNonce] = await getVaultOwnerAndNonce();

  const tx1 = new Transaction();
  tx1.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: baseVault.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: quoteVault.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: baseVault.publicKey,
      mint: baseMint,
      owner: vaultOwner,
    }),
    TokenInstructions.initializeAccount({
      account: quoteVault.publicKey,
      mint: quoteMint,
      owner: vaultOwner,
    }),
  );

  const tx2 = new Transaction();
  tx2.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: market.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(
        Market.getLayout(dexProgramId).span,
      ),
      space: Market.getLayout(dexProgramId).span,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: requestQueue.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(5120 + 12),
      space: 5120 + 12,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: eventQueue.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(262144 + 12),
      space: 262144 + 12,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: bids.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
      space: 65536 + 12,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: asks.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
      space: 65536 + 12,
      programId: dexProgramId,
    }),
    DexInstructions.initializeMarket({
      market: market.publicKey,
      requestQueue: requestQueue.publicKey,
      eventQueue: eventQueue.publicKey,
      bids: bids.publicKey,
      asks: asks.publicKey,
      baseVault: baseVault.publicKey,
      quoteVault: quoteVault.publicKey,
      baseMint,
      quoteMint,
      baseLotSize: new BN(baseLotSize),
      quoteLotSize: new BN(quoteLotSize),
      feeRateBps,
      vaultSignerNonce,
      quoteDustThreshold,
      programId: dexProgramId,
    }),
  );
  await _sendTransaction(connection, tx1, [payer, baseVault, quoteVault]);
  await _sendTransaction(connection, tx2, [
    payer,
    market,
    requestQueue,
    eventQueue,
    bids,
    asks,
  ]);

  return market.publicKey;
}

export async function listMarkets(
  connection: Connection,
  payer: Account,
  dexProgramId: PublicKey,
  mints: Token[],
  quoteMintPK: PublicKey,
): Promise<PublicKey[]> {
  const spotMarketPks: PublicKey[] = [];
  for (let mint of mints) {
    spotMarketPks.push(
      await listMarket(
        connection,
        payer,
        mint.publicKey,
        quoteMintPK,
        100, // TODO: Make this dynamic
        10, // TODO: Make this dynamic
        dexProgramId,
      ),
    );
  }
  return spotMarketPks;
}

export async function mintToTokenAccount(
  payer: Account,
  mint: Token,
  tokenAccountPk: PublicKey,
  balance: number,
): Promise<void> {
  const mintInfo = await mint.getMintInfo();
  await mint.mintTo(
    tokenAccountPk,
    payer,
    [],
    balance * Math.pow(10, mintInfo.decimals),
  );
}

export async function createUserTokenAccount(
  payer: Account,
  mint: Token,
  balance: number,
): Promise<PublicKey> {
  const tokenAccountPk = await mint.createAssociatedTokenAccount(
    payer.publicKey,
  );
  if (balance > 0) {
    await mintToTokenAccount(payer, mint, tokenAccountPk, balance);
  }
  return tokenAccountPk;
}

export async function createUserTokenAccounts(
  payer: Account,
  mints: Token[],
  balances: number[] | null,
): Promise<PublicKey[]> {
  const tokenAccountPks: PublicKey[] = [];
  if (!balances) balances = new Array(mints.length).fill(0);
  else if (balances.length !== mints.length)
    throw new Error("Balance and mint array lengths don't match");
  for (let i = 0; i < mints.length; i++) {
    const mint = mints[i];
    const balance = balances[i];
    tokenAccountPks.push(await createUserTokenAccount(payer, mint, balance));
  }
  return tokenAccountPks;
}

export async function addSpotMarketToMangoGroup(
  client: MangoClient,
  payer: Account,
  mangoGroup: MangoGroup,
  mint: Token,
  spotMarketPk: PublicKey,
  marketIndex: number,
  initialPrice: number,
): Promise<void> {
  const oraclePk = await createOracle(client.connection, MangoProgramId, payer);
  await client.addOracle(mangoGroup, oraclePk, payer);
  await client.setOracle(
    mangoGroup,
    oraclePk,
    payer,
    I80F48.fromNumber(initialPrice),
  );
  const initLeverage = 5;
  const maintLeverage = initLeverage * 2;
  const liquidationFee = 1 / (2 * maintLeverage);
  await client.addSpotMarket(
    mangoGroup,
    oraclePk,
    spotMarketPk,
    mint.publicKey,
    payer,
    maintLeverage,
    initLeverage,
    liquidationFee,
    OPTIMAL_UTIL,
    OPTIMAL_RATE,
    MAX_RATE,
  );
}

export async function addSpotMarketsToMangoGroup(
  client: MangoClient,
  payer: Account,
  mangoGroupPk: PublicKey,
  mints: Token[],
  spotMarketPks: PublicKey[],
): Promise<MangoGroup> {
  let mangoGroup = await client.getMangoGroup(mangoGroupPk);
  for (let i = 0; i < mints.length - 1; i++) {
    const mint = mints[i];
    const spotMarketPk = spotMarketPks[i];
    await addSpotMarketToMangoGroup(
      client,
      payer,
      mangoGroup,
      mint,
      spotMarketPk,
      i,
      40000,
    );
  }
  return await client.getMangoGroup(mangoGroupPk);
}

export async function getNodeBank(
  client: MangoClient,
  mangoGroup: MangoGroup,
  bankIndex: number,
): Promise<any> {
  let rootBanks = await mangoGroup.loadRootBanks(client.connection);
  const rootBank = rootBanks[bankIndex];
  if (!rootBank) throw new Error(`no root bank at index ${bankIndex}`);
  return rootBank.nodeBankAccounts[0];
}

export async function cachePrices(
  client: MangoClient,
  payer: Account,
  mangoGroup: MangoGroup,
  oracleIndices: number[],
): Promise<void> {
  const pricesToCache: PublicKey[] = [];
  for (let oracleIndex of oracleIndices) {
    pricesToCache.push(mangoGroup.oracles[oracleIndex]);
  }
  await client.cachePrices(
    mangoGroup.publicKey,
    mangoGroup.mangoCache,
    pricesToCache,
    payer,
  );
}

export async function cacheRootBanks(
  client: MangoClient,
  payer: Account,
  mangoGroup: MangoGroup,
  rootBankIndices: number[],
): Promise<void> {
  const rootBanksToCache: PublicKey[] = [];
  for (let rootBankIndex of rootBankIndices) {
    rootBanksToCache.push(mangoGroup.tokens[rootBankIndex].rootBank);
  }
  await client.cacheRootBanks(
    mangoGroup.publicKey,
    mangoGroup.mangoCache,
    rootBanksToCache,
    payer,
  );
}

export async function performDeposit(
  client: MangoClient,
  payer: Account,
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  nodeBank: any, //Todo: Can make explicit NodeBank maybe
  tokenAccountPk: PublicKey,
  tokenIndex: number,
  quantity: number,
) {
  await client.deposit(
    mangoGroup,
    mangoAccount,
    payer,
    mangoGroup.tokens[tokenIndex].rootBank,
    nodeBank.publicKey,
    nodeBank.vault,
    tokenAccountPk,
    quantity,
  );
  return await client.getMangoAccount(
    mangoAccount.publicKey,
    mangoGroup.dexProgramId,
  );
}

export async function getMarket(
  client: MangoClient,
  mangoGroup: MangoGroup,
  marketIndex: number,
) {
  return await Market.load(
    client.connection,
    mangoGroup.spotMarkets[marketIndex].spotMarket,
    {},
    mangoGroup.dexProgramId,
  );
}

export async function placeSpotOrder(
  client: MangoClient,
  payer: Account,
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  market: Market,
) {
  await client.placeSpotOrder(
    mangoGroup,
    mangoAccount,
    mangoGroup.mangoCache,
    market,
    payer,
    'buy',
    10000,
    1,
    'limit',
  );
  return await client.getMangoAccount(
    mangoAccount.publicKey,
    mangoGroup.dexProgramId,
  );
}

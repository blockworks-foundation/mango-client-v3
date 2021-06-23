import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { I80F48 } from './fixednum';
import {
  MetaData,
  RootBankLayout,
  TokenInfo,
  SpotMarketInfo,
  PerpMarketInfo,
  NodeBank,
  PerpMarket,
  PerpMarketLayout,
  MerpsCache,
  MerpsCacheLayout,
} from './layout';
import { RootBank } from './RootBank';
import { promiseUndef, zeroKey } from './utils';

export const MAX_TOKENS = 32;
export const MAX_PAIRS = MAX_TOKENS - 1;
export const MAX_NODE_BANKS = 8;
export const QUOTE_INDEX = MAX_TOKENS - 1;

export default class MerpsGroup {
  publicKey: PublicKey;
  metaData!: MetaData;
  numOracles!: number;
  tokens!: TokenInfo[];
  spotMarkets!: SpotMarketInfo[];
  perpMarkets!: PerpMarketInfo[];
  oracles!: PublicKey[];
  signerNonce!: BN;
  signerKey!: PublicKey;
  admin!: PublicKey;
  dexProgramId!: PublicKey;
  merpsCache!: PublicKey;
  validInterval!: number[];

  rootBankAccounts: (RootBank | undefined)[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
    this.oracles = this.oracles.filter((o) => !o.equals(zeroKey));

    this.rootBankAccounts = new Array(MAX_TOKENS).fill(undefined);
  }

  getOracleIndex(oracle: PublicKey): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.oracles[i].equals(oracle)) {
        return i;
      }
    }
    throw new Error('This Oracle does not belong to this MerpsGroup');
  }

  getSpotMarketIndex(spotMarket: PublicKey): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.spotMarkets[i].spotMarket.equals(spotMarket)) {
        return i;
      }
    }
    throw new Error('This Market does not belong to this MerpsGroup');
  }

  getPerpMarketIndex(perpMarket: PerpMarket): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.perpMarkets[i].perpMarket.equals(perpMarket.publicKey)) {
        return i;
      }
    }
    throw new Error('This PerpMarket does not belong to this MerpsGroup');
  }

  getTokenIndex(token: PublicKey): number {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].mint.equals(token)) {
        return i;
      }
    }
    throw new Error('This token does not belong in this MerpsGroup');
  }

  getRootBankIndex(rootBank: PublicKey): number {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].rootBank.equals(rootBank)) {
        return i;
      }
    }
    throw new Error('This root bank does not belong in this MerpsGroup');
  }

  getBorrowRate(tokenIndex: number): I80F48 {
    const rootBank = this.rootBankAccounts[tokenIndex];
    if (!rootBank)
      throw new Error(`Root bank at index ${tokenIndex} is not loaded`);

    return rootBank.getBorrowRate(this);
  }

  getDepositRate(tokenIndex: number): I80F48 {
    const rootBank = this.rootBankAccounts[tokenIndex];
    if (!rootBank)
      throw new Error(`Root bank at index ${tokenIndex} is not loaded`);

    return rootBank.getDepositRate(this);
  }

  async loadCache(connection: Connection): Promise<MerpsCache> {
    const account = await connection.getAccountInfo(this.merpsCache);
    if (!account || !account?.data) throw new Error('Unable to load cache');

    const decoded = MerpsCacheLayout.decode(account.data);
    return new MerpsCache(this.merpsCache, decoded);
  }

  async loadRootBanks(
    connection: Connection,
  ): Promise<(RootBank | undefined)[]> {
    const promises: Promise<AccountInfo<Buffer> | undefined | null>[] = [];

    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].rootBank.equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(connection.getAccountInfo(this.tokens[i].rootBank));
      }
    }

    const accounts = await Promise.all(promises);
    const parsedRootBanks = accounts.map((acc, i) => {
      if (acc && acc.data) {
        const decoded = RootBankLayout.decode(acc.data);
        return new RootBank(this.tokens[i].rootBank, decoded);
      }
      return undefined;
    });

    await Promise.all(
      parsedRootBanks.map((rootBank) =>
        rootBank ? rootBank.loadNodeBanks(connection) : promiseUndef(),
      ),
    );

    this.rootBankAccounts = parsedRootBanks;
    return parsedRootBanks;
  }

  async loadPerpMarket(
    connection: Connection,
    marketIndex: number,
    baseDecimals: number,
    quoteDecimals: number,
  ): Promise<PerpMarket> {
    const pk = this.perpMarkets[marketIndex].perpMarket;
    const acc = await connection.getAccountInfo(pk);
    const decoded = PerpMarketLayout.decode(acc?.data);
    return new PerpMarket(pk, baseDecimals, quoteDecimals, decoded);
  }

  /*
  async loadPerpMarkets(
    connection: Connection,
  ): Promise<(PerpMarket | undefined)[]> {
    const promises: Promise<AccountInfo<Buffer> | undefined | null>[] = [];

    for (let i = 0; i < this.tokens.length; i++) {
      if (
        !this.perpMarkets[i] ||
        this.perpMarkets[i].perpMarket.equals(zeroKey)
      ) {
        promises.push(promiseUndef());
      } else {
        promises.push(
          connection.getAccountInfo(this.perpMarkets[i].perpMarket),
        );
      }
    }

    const accounts = await Promise.all(promises);

    return accounts.map((acc, i) => {
      if (acc && acc.data) {
        const decoded = PerpMarketLayout.decode(acc.data);
        return new PerpMarket(this.perpMarkets[i].perpMarket, decoded);
      }
      return undefined;
    });
  }
  */
}

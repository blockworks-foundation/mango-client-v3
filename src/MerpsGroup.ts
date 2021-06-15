import { Market } from '@project-serum/serum';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  MetaData,
  RootBank,
  RootBankLayout,
  TokenInfo,
  SpotMarketInfo,
  PerpMarketInfo,
  NodeBank,
  PerpMarket,
} from './layout';
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

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }

  getSpotMarketIndex(spotMarket: Market): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.spotMarkets[i].spotMarket.equals(spotMarket.publicKey)) {
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

    return accounts.map((acc, i) => {
      if (acc && acc.data) {
        const decoded = RootBankLayout.decode(acc.data);
        return new RootBank(this.tokens[i].rootBank, decoded);
      }
      return undefined;
    });
  }

  async loadBanksForSpotMarket(
    connection: Connection,
    spotMarketIndex: number,
  ): Promise<{
    baseRootBank: RootBank | undefined;
    baseNodeBank: NodeBank | undefined;
    quoteRootBank: RootBank | undefined;
    quoteNodeBank: NodeBank | undefined;
  }> {
    const rootBanks = await this.loadRootBanks(connection);

    const baseRootBank = rootBanks[spotMarketIndex];
    const quoteRootBank = rootBanks[QUOTE_INDEX];

    // TODO need to handle multiple node banks
    const nodeBankIndex = 0;
    const baseNodeBankPk = baseRootBank?.nodeBanks[nodeBankIndex];
    const quoteNodeBankPk = quoteRootBank?.nodeBanks[nodeBankIndex];

    const baseNodeBanks = await baseRootBank?.loadNodeBanks(connection);
    const quoteNodeBanks = await quoteRootBank?.loadNodeBanks(connection);

    const baseNodeBank = baseNodeBanks?.find(
      (nodeBank) => nodeBank?.publicKey == baseNodeBankPk,
    );
    const quoteNodeBank = quoteNodeBanks?.find(
      (nodeBank) => nodeBank?.publicKey == quoteNodeBankPk,
    );

    return { baseRootBank, baseNodeBank, quoteRootBank, quoteNodeBank };
  }
}

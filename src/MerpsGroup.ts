import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { MetaData } from "./layout";

export default class MerpsGroup {
  publicKey: PublicKey;
  metaData!: MetaData;
  numTokens!: number;
  numMarkets!: number;
  tokens!: PublicKey[];
  oracles!: PublicKey[];
  spotMarkets!: PublicKey[];
  perpMarkets!: PublicKey[];
  rootBanks!: PublicKey[];
  assetWeights!: BN[];
  signerNonce!: BN;
  signerKey!: PublicKey;
  admin!: PublicKey;
  dexProgramId!: PublicKey;
  merpsCache!: PublicKey;
  validInterval!: number[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey
    Object.assign(this, decoded)
  }
}
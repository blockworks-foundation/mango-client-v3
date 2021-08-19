import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import { getOracleBySymbol, GroupConfig } from '../config';

// devnet
const PYTH_ORACLES_DEVNET = {
  BTC: 'HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J',
  ETH: 'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw',
  SOL: 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix',
  SRM: '992moaMQKs32GKZ9dxi8keyM2bUmbrwBZpK4p2K6X5Vs',
  RAY: '8PugCXTAHLM9kfLSQWe2njE5pzAgUdpPk3Nx5zSm7BD3', // LUNA
  MNGO: '4GqTjGm686yihQ1m1YdTsSvfm4mNfadv6xskzgCYWNC5', // XAU
  DOGE: '4L6YhY8VvUgmqG5MvJkUJATtzB2rFqdrJwQCmFLv4Jzy',
  SUSHI: 'BLArYBCUYhdWiY8PCUTpvFE21iaJq85dvxLk9bYMobcU', // LTC
  FTT: '6vivTRs5ZPeeXbjo7dfburfaYDWoXjBtdtuYgQRuGfu',
  USDT: '38xoQ4oeJCBrcVvca2cGk7iV1dAfrmTR1kmhSCJQ8Jto',
};

// mainnet
const PYTH_ORACLES_MAINNET = {
  BTC: '2YDWKqoJ1jZgoirNC4c4WLj2JAAf8hxLz5A9HTmPG2AC',
  ETH: '3NBReDRTLKMQEKiLD5tGcx4kXbTf88b7f2xLS9UuGjym',
  SOL: '2k1qZ9ZMNUNmpGghq6ZQRj7z2d2ATNnzzYugVhiTDCPn',
  SRM: 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB',
  USDT: 'B8piRrj78PWq59VL5PJ4fZ8JxbsQB6sFKQTuaEEGsCuz',
};

export default async function addPythOracle(
  connection: Connection,
  payer: Account,
  groupConfig: GroupConfig,
  symbol: string,
): Promise<GroupConfig> {
  console.log({
    connection,
    payer,
    groupConfig,
    symbol,
  });

  const client = new MangoClient(connection, groupConfig.mangoProgramId);
  const group = await client.getMangoGroup(groupConfig.publicKey);
  let oraclePk;
  if (groupConfig.cluster === 'mainnet') {
    oraclePk = new PublicKey(PYTH_ORACLES_MAINNET[symbol]);
  } else {
    oraclePk = new PublicKey(PYTH_ORACLES_DEVNET[symbol]);
  }
  await client.addOracle(group, oraclePk, payer);

  const oracle = {
    symbol: symbol,
    publicKey: oraclePk,
  };

  const _oracle = getOracleBySymbol(groupConfig, symbol);
  if (_oracle) {
    Object.assign(_oracle, oracle);
  } else {
    groupConfig.oracles.push(oracle);
  }

  return groupConfig;
}

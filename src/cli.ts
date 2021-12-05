#!/usr/bin/env node
// TODO put node banks and vaults inside the GroupConfig
import * as fs from 'fs';
import * as os from 'os';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { Options, PositionalOptions } from 'yargs';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';

import {
  addPerpMarket,
  addPythOracle,
  addSpotMarket,
  addStubOracle,
  addSwitchboardOracle,
  initGroup,
  listMarket,
  sanityCheck,
  setStubOracle,
} from './commands';
import {
  Cluster,
  Config,
  getPerpMarketByBaseSymbol,
  getTokenBySymbol,
  GroupConfig,
  PerpMarketConfig,
} from './config';
import { MangoClient } from './client';
import { throwUndefined, uiToNative } from './utils';

const clusterDesc: [string, Options] = [
  'cluster',
  {
    describe: 'the cluster to connect to',
    default: 'devnet',
    choices: ['devnet', 'mainnet'],
  },
];

const configDesc: [string, Options] = [
  'config',
  {
    describe: 'the config file to store all public keys',
    default: __dirname + '/ids.json',
    type: 'string',
  },
];
const keypairDesc: [string, Options] = [
  'keypair',
  {
    describe: 'the keypair used to sign all transactions',
    default: os.homedir() + '/.config/solana/devnet.json',
    type: 'string',
  },
];
const groupDesc: [string, PositionalOptions] = [
  'group',
  { describe: 'the mango group name 🥭', type: 'string' },
];
const symbolDesc: [string, PositionalOptions] = [
  'symbol',
  { describe: 'the base token symbol', type: 'string' },
];

function openConnection(config: Config, cluster: Cluster) {
  return new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );
}

function readKeypair(keypairPath: string) {
  return new Account(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')));
}

export function readConfig(configPath: string) {
  return new Config(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
}

export function writeConfig(configPath: string, config: Config) {
  fs.writeFileSync(configPath, JSON.stringify(config.toJson(), null, 2));
}

yargs(hideBin(process.argv)).command(
  'init-group <group> <mangoProgramId> <serumProgramId> <quote_mint> <fees_vault>',
  'initialize a new group',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional('mangoProgramId', {
        describe: 'the program id of the mango smart contract',
        type: 'string',
      })
      .positional('serumProgramId', {
        describe: 'the program id of the serum dex smart contract',
        type: 'string',
      })
      .positional('quote_mint', {
        describe: 'the mint of the quote currency 💵',
        type: 'string',
      })
      .positional('fees_vault', {
        describe:
          'the quote currency vault owned by Mango DAO token governance',
        type: 'string',
      })
      .option('quote_optimal_util', {
        describe: 'optimal utilization interest rate param for quote currency',
        default: 0.7,
        type: 'number',
      })
      .option('quote_optimal_rate', {
        describe: 'optimal interest rate param for quote currency',
        default: 0.06,
        type: 'number',
      })
      .option('quote_max_rate', {
        describe: 'max interest rate param for quote currency',
        default: 1.5,
        type: 'number',
      })
      .option('valid_interval', {
        describe: 'the interval where caches are no longer valid',
        default: 10,
        type: 'number',
      })
      .option('symbol', {
        describe: 'the quote symbol',
        default: 'USDC',
        type: 'string',
      })
      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('init_group', args);
    const mangoProgramId = new PublicKey(args.mangoProgramId as string);
    const serumProgramId = new PublicKey(args.serumProgramId as string);
    const quoteMint = new PublicKey(args.quote_mint as string);
    const feesVault = new PublicKey(args.fees_vault as string);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const result = await initGroup(
      connection,
      account,
      cluster,
      args.group as string,
      mangoProgramId,
      serumProgramId,
      args.symbol as string,
      quoteMint,
      feesVault,
      args.valid_interval as number,
      args.quote_optimal_util as number,
      args.quote_optimal_rate as number,
      args.quote_max_rate as number,
    );
    console.log(result);
    config.storeGroup(result);
    writeConfig(args.config as string, config);
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'add-oracle <group> <symbol>',
  'add an oracle to the group',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional(...symbolDesc)
      .option('provider', {
        describe: 'oracle provider',
        default: 'stub',
        choices: ['stub', 'pyth', 'switchboard'],
      })
      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('add_oracle', args);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const group = config.getGroup(cluster, args.group as string) as GroupConfig;
    let result: any;
    if (args.provider === 'pyth') {
      result = await addPythOracle(
        connection,
        account,
        group,
        args.symbol as string,
      );
    } else if (args.provider === 'switchboard') {
      result = await addSwitchboardOracle(
        connection,
        account,
        group,
        args.symbol as string,
      );
    } else if (args.provider === 'stub') {
      result = await addStubOracle(
        connection,
        account,
        group,
        args.symbol as string,
      );
    } else {
      throw new Error();
    }
    config.storeGroup(result);
    writeConfig(args.config as string, config);
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'set-oracle <group> <symbol> <value>',
  'set stub oracle to given value',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional(...symbolDesc)
      .positional('value', {
        describe: 'new oracle value is base_price * quote_unit / base_unit',
        type: 'number',
      })
      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('set_oracle', args);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const group = config.getGroup(cluster, args.group as string) as GroupConfig;

    await setStubOracle(
      connection,
      account,
      group,
      args.symbol as string,
      args.value as number,
    );
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'add-perp-market <group> <symbol>',
  'add a perp market to the group',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional(...symbolDesc)
      .option('maint_leverage', {
        default: 20,
        type: 'number',
      })
      .option('init_leverage', {
        default: 10,
        type: 'number',
      })
      .option('liquidation_fee', {
        default: 0.025,
        type: 'number',
      })
      .option('maker_fee', {
        default: 0.0,
        type: 'number',
      })
      .option('taker_fee', {
        default: 0.0005,
        type: 'number',
      })
      .option('base_lot_size', {
        default: 100,
        type: 'number',
      })
      .option('quote_lot_size', {
        default: 10,
        type: 'number',
      })
      .option('max_num_events', {
        default: 256,
        type: 'number',
      })
      .option('rate', {
        default: 1, // think of better starting rate
        type: 'number',
      })
      .option('max_depth_bps', {
        default: 200,
        type: 'number',
      })
      .option('target_period_length', {
        default: 3600,
        type: 'number',
      })
      .option('mngo_per_period', {
        // default: 11400, // roughly corresponds to 100m MNGO per year
        default: 0, // going to be 0 for internal release
        type: 'number',
      })
      .option('exp', {
        default: 2,
        type: 'number',
      })

      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('add-perp-market', args);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const group = config.getGroup(cluster, args.group as string) as GroupConfig;
    const result = await addPerpMarket(
      connection,
      account,
      group,
      args.symbol as string,
      args.maint_leverage as number,
      args.init_leverage as number,
      args.liquidation_fee as number,
      args.maker_fee as number,
      args.taker_fee as number,
      args.base_lot_size as number,
      args.quote_lot_size as number,
      args.max_num_events as number,
      args.rate as number,
      args.max_depth_bps as number,
      args.target_period_length as number,
      args.mngo_per_period as number,
      args.exp as number,
    );
    config.storeGroup(result);
    writeConfig(args.config as string, config);
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'add-spot-market <group> <symbol> <mint_pk>',
  'add a spot market to the group',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional(...symbolDesc)
      .positional('mint_pk', {
        describe: 'the public key of the base token mint',
        type: 'string',
      })
      .option('market_pk', {
        default: '',
        describe: 'the public key of the spot market',
        type: 'string',
      })
      .option('base_lot_size', {
        default: 100,
        describe: 'Lot size of the base mint',
        type: 'number',
      })
      .option('quote_lot_size', {
        default: 10,
        describe: 'Lot size of the quote mint',
        type: 'number',
      })
      .option('maint_leverage', {
        default: 10,
        type: 'number',
      })
      .option('init_leverage', {
        default: 5,
        type: 'number',
      })
      .option('liquidation_fee', {
        default: 0.05,
        type: 'number',
      })
      .option('optimal_util', {
        describe: 'optimal utilization interest rate param',
        default: 0.7,
        type: 'number',
      })
      .option('optimal_rate', {
        describe: 'optimal interest rate param',
        default: 0.06,
        type: 'number',
      })
      .option('max_rate', {
        describe: 'max interest rate param',
        default: 1.5,
        type: 'number',
      })

      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('add-spot-market', args);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const group = config.getGroup(cluster, args.group as string) as GroupConfig;
    const quoteMintPk = getTokenBySymbol(group, group.quoteSymbol)
      ?.mintKey as PublicKey;
    const market_pk = args.market_pk
      ? new PublicKey(args.market_pk as string)
      : await listMarket(
          connection,
          account,
          group.mangoProgramId,
          new PublicKey(args.mint_pk as string),
          quoteMintPk,
          args.base_lot_size as number,
          args.quote_lot_size as number,
          group.serumProgramId,
        );
    const result = await addSpotMarket(
      connection,
      account,
      group,
      args.symbol as string,
      market_pk,
      new PublicKey(args.mint_pk as string),
      args.maint_leverage as number,
      args.init_leverage as number,
      args.liquidation_fee as number,
      args.optimal_util as number,
      args.optimal_rate as number,
      args.max_rate as number,
    );
    config.storeGroup(result);
    writeConfig(args.config as string, config);
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'sanity-check <group>',
  'check group conditions that always have to be true',
  (y) => {
    return y.positional(...groupDesc).option(...configDesc);
  },
  async (args) => {
    console.log('sanity check', args);
    const config = readConfig(args.config as string);
    const groupConfig = config.getGroupWithName(
      args.group as string,
    ) as GroupConfig;

    const connection = openConnection(config, groupConfig.cluster);

    await sanityCheck(connection, groupConfig);
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'show <group> <mango_account_pk>',
  'Print relevant details about a mango account',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional('mango_account_pk', {
        describe: 'the public key of the MangoAccount',
        type: 'string',
      })
      .option(...configDesc);
  },
  async (args) => {
    console.log('show', args);
    const config = readConfig(args.config as string);
    const groupConfig = config.getGroupWithName(
      args.group as string,
    ) as GroupConfig;

    const connection = openConnection(config, groupConfig.cluster);

    const client = new MangoClient(connection, groupConfig.mangoProgramId);
    const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
    const mangoAccount = await client.getMangoAccount(
      new PublicKey(args.mango_account_pk as string),
      groupConfig.serumProgramId,
    );
    const cache = await mangoGroup.loadCache(connection);
    console.log(mangoAccount.toPrettyString(groupConfig, mangoGroup, cache));
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'show-perp-market <group> <symbol>',
  'Print relevant details about a perp market',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional('symbol', {
        describe: 'The ticker symbol of the perp market',
        type: 'string',
      })
      .option(...configDesc);
  },
  async (args) => {
    console.log('show-perp-market', args);
    const config = readConfig(args.config as string);
    const groupConfig = config.getGroupWithName(
      args.group as string,
    ) as GroupConfig;

    const perpMarketConfig: PerpMarketConfig = throwUndefined(
      getPerpMarketByBaseSymbol(groupConfig, args.symbol as string),
    );

    const connection = openConnection(config, groupConfig.cluster);
    const client = new MangoClient(connection, groupConfig.mangoProgramId);
    const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);

    const perpMarket = await client.getPerpMarket(
      perpMarketConfig.publicKey,
      perpMarketConfig.baseDecimals,
      perpMarketConfig.quoteDecimals,
    );
    console.log(perpMarket.toPrettyString(mangoGroup, perpMarketConfig));

    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'verify-token-gov <token_account> <owner>',
  'Verify the owner of token_account is a governance PDA',
  (y) => {
    return y
      .positional('token_account', {
        describe: 'the public key of the MangoAccount',
        type: 'string',
      })
      .positional('owner', {
        describe: 'The owner of the token_account',
        type: 'string',
      })
      .option('program_id', {
        default: 'GqTPL6qRf5aUuqscLh8Rg2HTxPUXfhhAXDptTLhp1t2J',
        describe: 'Mango DAO program id',
        type: 'string',
      })
      .option('realm', {
        default: 'DPiH3H3c7t47BMxqTxLsuPQpEC6Kne8GA9VXbxpnZxFE',
        describe: 'Realm of this governance',
        type: 'string',
      });
  },
  async (args) => {
    const programId = new PublicKey(args.program_id as string);
    const realm = new PublicKey(args.realm as string);
    const tokenAccount = new PublicKey(args.token_account as string);
    const owner = new PublicKey(args.owner as string);
    const [address] = await PublicKey.findProgramAddress(
      [
        Buffer.from('token-governance', 'utf-8'),
        realm.toBuffer(),
        tokenAccount.toBuffer(),
      ],
      programId,
    );

    if (address.equals(owner)) {
      console.log(
        `Success. The token_account: ${tokenAccount.toBase58()} is owned by a governance PDA`,
      );
    } else {
      console.log(`Failure`);
    }

    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'change-perp-market-params <group> <symbol>',
  'change params for a perp market',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional(...symbolDesc)
      .option('maint_leverage', {
        type: 'number',
      })
      .option('init_leverage', {
        type: 'number',
      })
      .option('liquidation_fee', {
        type: 'number',
      })
      .option('maker_fee', {
        type: 'number',
      })
      .option('taker_fee', {
        type: 'number',
      })
      .option('rate', {
        type: 'number',
      })
      .option('max_depth_bps', {
        type: 'number',
      })
      .option('target_period_length', {
        type: 'number',
      })
      .option('mngo_per_period', {
        type: 'number',
      })
      .option('exp', {
        type: 'number',
      })

      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('change-perp-market-params', args);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const groupConfig = config.getGroup(
      cluster,
      args.group as string,
    ) as GroupConfig;
    const symbol = args.symbol as string;
    const client = new MangoClient(connection, groupConfig.mangoProgramId);

    const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
    const perpMarketConfig: PerpMarketConfig = throwUndefined(
      getPerpMarketByBaseSymbol(groupConfig, symbol),
    );
    const perpMarket = await client.getPerpMarket(
      perpMarketConfig.publicKey,
      perpMarketConfig.baseDecimals,
      perpMarketConfig.quoteDecimals,
    );
    // console.log(perpMarket.liquidityMiningInfo.rate.toString());
    // console.log(perpMarket.liquidityMiningInfo.mngoPerPeriod.toString());
    // console.log(perpMarket.liquidityMiningInfo.mngoLeft.toString());
    // console.log(perpMarket.liquidityMiningInfo.periodStart.toString());
    // console.log(perpMarket.liquidityMiningInfo.targetPeriodLength.toString());
    let mngoPerPeriod = getNumberOrUndef(args, 'mngo_per_period');
    if (mngoPerPeriod !== undefined) {
      const token = getTokenBySymbol(groupConfig, 'MNGO');
      mngoPerPeriod = uiToNative(mngoPerPeriod, token.decimals).toNumber();
    }
    const exp = getNumberOrUndef(args, 'exp');
    if (exp !== undefined && !Number.isInteger(exp)) {
      throw new Error('exp must be an integer');
    }
    await client.changePerpMarketParams(
      mangoGroup,
      perpMarket,
      account,
      getNumberOrUndef(args, 'maint_leverage'),
      getNumberOrUndef(args, 'init_leverage'),
      getNumberOrUndef(args, 'liquidation_fee'),
      getNumberOrUndef(args, 'maker_fee'),
      getNumberOrUndef(args, 'taker_fee'),
      getNumberOrUndef(args, 'rate'),
      getNumberOrUndef(args, 'max_depth_bps'),
      getNumberOrUndef(args, 'target_period_length'),
      mngoPerPeriod,
      exp,
    );
    // await sleep(2000);
    // perpMarket = await client.getPerpMarket(
    //   perpMarketConfig.publicKey,
    //   perpMarketConfig.baseDecimals,
    //   perpMarketConfig.quoteDecimals,
    // );
    // console.log(perpMarket.liquidityMiningInfo.rate.toString());
    // console.log(perpMarket.liquidityMiningInfo.mngoPerPeriod.toString());
    // console.log(perpMarket.liquidityMiningInfo.mngoLeft.toString());
    // console.log(perpMarket.liquidityMiningInfo.periodStart.toString());
    // console.log(perpMarket.liquidityMiningInfo.targetPeriodLength.toString());

    process.exit(0);
  },
).argv;

function getNumberOrUndef(args, k): number | undefined {
  return args[k] === undefined ? undefined : (args[k] as number);
}

yargs(hideBin(process.argv)).command(
  'set-admin <group> <admin_pk>',
  'transfer admin permissions over group to another account',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional('admin_pk', {
        describe: 'the public key of the new group admin',
        type: 'string',
      })
      .option(...clusterDesc)
      .option(...configDesc)
      .option(...keypairDesc);
  },
  async (args) => {
    console.log('set-admin', args);
    const account = readKeypair(args.keypair as string);
    const config = readConfig(args.config as string);
    const cluster = args.cluster as Cluster;
    const connection = openConnection(config, cluster);
    const groupConfig = config.getGroup(
      cluster,
      args.group as string,
    ) as GroupConfig;

    const client = new MangoClient(connection, groupConfig.mangoProgramId);
    const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
    await client.setGroupAdmin(
      mangoGroup,
      new PublicKey(args.admin_pk as string),
      account,
    );
    process.exit(0);
  },
).argv;

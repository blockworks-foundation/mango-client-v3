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
  addSpotMarket,
  addStubOracle,
  addPythOracle,
  initGroup,
  setStubOracle,
} from './commands';
import { Cluster, Config, GroupConfig } from './config';
import { MangoClient } from './client';

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
  'init-group <group> <mangoProgramId> <serumProgramId> <quote_mint>',
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
      5,
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
        choices: ['stub', 'pyth'],
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
        default: 0.0001,
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
        default: 128,
        type: 'number',
      })
      .option('rate', {
        default: 1,
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
        default: 11400, // roughly corresponds to 100m MNGO per year
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
    );
    config.storeGroup(result);
    writeConfig(args.config as string, config);
    process.exit(0);
  },
).argv;

yargs(hideBin(process.argv)).command(
  'add-spot-market <group> <symbol> <market_pk> <mint_pk>',
  'add a spot market to the group',
  (y) => {
    return y
      .positional(...groupDesc)
      .positional(...symbolDesc)
      .positional('market_pk', {
        describe: 'the public key of the spot market',
        type: 'string',
      })
      .positional('mint_pk', {
        describe: 'the public key of the base token mint',
        type: 'string',
      })
      .option('maint_leverage', {
        default: 10,
        type: 'number',
      })
      .option('init_leverage', {
        default: 5,
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
    const result = await addSpotMarket(
      connection,
      account,
      group,
      args.symbol as string,
      new PublicKey(args.market_pk as string),
      new PublicKey(args.mint_pk as string),
      args.maint_leverage as number,
      args.init_leverage as number,
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
  'show <mango_account_pk>',
  'Print relevant details about a mango account',
  (y) => {
    return y
      .positional('mango_account_pk', {
        describe: 'the public key of the MangoAccount',
        type: 'string',
      })
      .option('group', {
        describe: 'the mango group name 🥭',
        default: 'mango_test_v3.4',
        type: 'string',
      })
      .option(...configDesc)
      .option(...clusterDesc);
  },
  async (args) => {
    console.log('show', args);
    const cluster = args.cluster as Cluster;
    const config = readConfig(args.config as string);

    const connection = openConnection(config, cluster);

    const groupConfig = config.getGroup(
      cluster,
      args.group as string,
    ) as GroupConfig;

    const client = new MangoClient(connection, groupConfig.mangoProgramId);
    const mangoAccount = await client.getMangoAccount(
      new PublicKey(args.mango_account_pk as string),
      groupConfig.serumProgramId,
    );
    // TODO - write a proper to string
    console.log(mangoAccount.perpAccounts[0].basePosition.toString());
    process.exit(0);
  },
).argv;

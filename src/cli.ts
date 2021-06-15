#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { Options, PositionalOptions } from 'yargs';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';

import { initGroup } from './commands';

const clusterDesc: [string, Options] = [
  'cluster',
  {
    describe: 'the cluster to connect to',
    default: 'devnet',
    choices: ['devnet', 'mainnet'],
  },
];
const keypairDesc: [string, Options] = [
  'keypair',
  {
    describe: 'the keypair used to sign all transactions',
    default: os.homedir() + '/.config/solana/id.json',
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

function openConnection(_: string | unknown) {
  return new Connection(
    'https://api.devnet.solana.com', // TODO: fix url
    'processed' as Commitment,
  );
}

function useKeypair(keypairPath: string) {
  return new Account(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')));
}

yargs(hideBin(process.argv))
  .command(
    'init_group <group> <merps_program_id> <quote_mint>',
    'initialize a new group',
    (y) =>
      y
        .positional(...groupDesc)
        .positional('merps_program_id', {
          describe: 'the program id of the merps smart contract',
          type: 'string',
        })
        .positional('serum_program_id', {
          describe: 'the program id of the serum dex smart contract',
          type: 'string',
        })
        .positional('quote_mint', {
          describe: 'the mint of the quote currency 💵',
          type: 'string',
        })
        .option('symbol', {
          describe: 'the quote symbol',
          default: 'USDC',
          type: 'string',
        })
        .option(...clusterDesc)
        .option(...keypairDesc),
    (args) => {
      const merpsProgramId = new PublicKey(args.merps_program_id as string);
      const serumProgramId = new PublicKey(args.serum_program_id as string);
      const quoteMint = new PublicKey(args.quote_mint as string);
      const account = useKeypair(args.keypair as string);
      const result = initGroup(
        openConnection(args.cluster),
        account,
        args.group as string,
        merpsProgramId,
        serumProgramId,
        args.symbol as string,
        quoteMint,
      );
      console.log(result);
    },
  )
  .command(
    'add_oracle <group> <symbol> <mint>',
    'add an oracle to the group',
    (y) =>
      y
        .positional(...groupDesc)
        .positional(...symbolDesc)
        .positional('mint', { describe: 'the base token mint', type: 'string' })
        .option('provider', {
          describe: 'oracle provider',
          default: 'stub',
          choices: ['stub', 'pyth'],
        }),
    (_args) => {},
  )
  .command(
    'add_perp_market <group> <symbol>',
    'add a perp market to the group',
    (y) => y.positional(...groupDesc).positional(...symbolDesc),
    (_args) => {},
  ).argv;

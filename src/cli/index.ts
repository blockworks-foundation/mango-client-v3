#!/usr/bin/env node
// TODO put node banks and vaults inside the GroupConfig
import * as fs from 'fs';
import * as os from 'os';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { Options, PositionalOptions } from 'yargs';
import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
	Cluster,
	Config,
	getPerpMarketByBaseSymbol,
	getPerpMarketByIndex,
	getSpotMarketByBaseSymbol,
	getTokenBySymbol,
	GroupConfig,
	PerpMarketConfig,
	SpotMarketConfig,
} from '../config';
import {MangoClient} from '../client';
import {throwUndefined, uiToNative} from '../utils/utils';
import {QUOTE_INDEX} from '../layout';
import {Coder} from '@project-serum/anchor';
import idl from '../mango_logs.json';
import {getMarketIndexBySymbol} from '../config';
import {Market} from '@project-serum/serum';
import initGroup from './initGroup';
import addPerpMarket from './addPerpMarket';
import addSpotMarket from './addSpotMarket';
import addStubOracle from './addStubOracle';
import addPythOracle from './addPythOracle';
import addSwitchboardOracle from './addSwitchboardOracle';
import setStubOracle from './setStubOracle';
import listMarket from './listMarket';
import sanityCheck from './sanityCheck';

export {
	addPerpMarket,
	addSpotMarket,
	addStubOracle,
	addPythOracle,
	addSwitchboardOracle,
	initGroup,
	setStubOracle,
	listMarket,
	sanityCheck,
};

const clusterDesc: [string, Options] = [
	'cluster',
	{
		describe: 'the cluster to connect to',
		default: 'localnet',
		choices: ['devnet', 'mainnet', 'localnet'],
	},
];

const configDesc: [string, Options] = [
	'config',
	{
		describe: 'the config file to store all public keys',
		default: './src/ids.json',
		type: 'string',
	},
];
const keypairDesc: [string, Options] = [
	'keypair',
	{
		describe: 'the keypair used to sign all transactions',
		default: os.homedir() + '/.config/solana/localnet.json',
		type: 'string',
	},
];
const groupDesc: [string, PositionalOptions] = [
	'group',
	{describe: 'the mango group name 🥭', type: 'string'},
];
const symbolDesc: [string, PositionalOptions] = [
	'symbol',
	{describe: 'the base token symbol', type: 'string'},
];

function openConnection(config: Config, cluster: Cluster) {
	return new Connection(
		config.cluster_urls[cluster],
		'processed' as Commitment,
	);
}

function readKeypair(keypairPath: string) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8'))),
  );
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
    if (!result) {
      return;
    }
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
	'inspect-wallet <group> <wallet_pk>',
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
		console.log('inspect-wallet', args);
		const config = readConfig(args.config as string);
		const groupConfig = config.getGroupWithName(
			args.group as string,
		) as GroupConfig;

		const connection = openConnection(config, groupConfig.cluster);

		const client = new MangoClient(connection, groupConfig.mangoProgramId);
		const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
		const mangoAccounts = await client.getMangoAccountsForOwner(
			mangoGroup,
			new PublicKey(args.wallet_pk as string),
			false,
		);
		console.log('total # mango accts: ', mangoAccounts.length);
		const cache = await mangoGroup.loadCache(connection);
		for (const mangoAccount of mangoAccounts) {
			console.log(mangoAccount.toPrettyString(groupConfig, mangoGroup, cache));
		}

		process.exit(0);
	},
).argv;

yargs(hideBin(process.argv)).command(
	'decode-log <log_b64>',
	'Decode and print out log',
	(y) => {
		return y
			.positional('log_b64', {
				describe: 'base 64 encoded mango log',
				type: 'string',
			})
			.option(...configDesc);
	},
	async (args) => {
		console.log('decode-log', args);
		// @ts-ignore
		const coder = new Coder(idl);
		const event = coder.events.decode(args.log_b64 as string);
		if (!event) {
			throw new Error('Invalid mango log');
		}
		const data: any = event.data;

		if (event.name === 'CancelAllPerpOrdersLog') {
			data.allOrderIds = data.allOrderIds.map((oid) => oid.toString());
			data.canceledOrderIds = data.canceledOrderIds.map((oid) =>
				oid.toString(),
			);
			data.mangoGroup = data['mangoGroup'].toString();
			data.mangoAccount = data['mangoAccount'].toString();
		} else {
			for (const key in data) {
				data[key] = data[key].toString();
			}
		}

		console.log(event);
		process.exit(0);
	},
).argv;

yargs(hideBin(process.argv)).command(
	'show-group <group>',
	'Print relevant details about a MangoGroup',
	(y) => {
		return y.positional(...groupDesc).option(...configDesc);
	},
	async (args) => {
		console.log('show-group', args);
		const config = readConfig(args.config as string);
		const groupConfig = config.getGroupWithName(
			args.group as string,
		) as GroupConfig;

		const connection = openConnection(config, groupConfig.cluster);

		const client = new MangoClient(connection, groupConfig.mangoProgramId);
		const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);

		for (let i = 0; i < QUOTE_INDEX; i++) {
			const perpMarket = mangoGroup.perpMarkets[i];
			if (perpMarket.isEmpty()) {
				continue;
			}
			const pmc = getPerpMarketByIndex(groupConfig, i) as PerpMarketConfig;
			const pm = await client.getPerpMarket(
				perpMarket.perpMarket,
				pmc.baseDecimals,
				pmc.quoteDecimals,
			);
			const x = await connection.getTokenAccountBalance(pm.mngoVault);
			console.log(pmc.baseSymbol, pm.mngoVault.toBase58(), x);
		}

		process.exit(0);
	},
).argv;

yargs(hideBin(process.argv)).command(
	'show-insurance-vault <group>',
	'Print relevant details about a MangoGroup',
	(y) => {
		return y.positional(...groupDesc).option(...configDesc);
	},
	async (args) => {
		console.log('show-group', args);
		const config = readConfig(args.config as string);
		const groupConfig = config.getGroupWithName(
			args.group as string,
		) as GroupConfig;

		const connection = openConnection(config, groupConfig.cluster);

		const vaultBalance = await connection.getTokenAccountBalance(
			new PublicKey('59BEyxwrFpt3x4sZ7TcXC3bHx3seGfqGkATcDx6siLWy'),
		);

		console.log(`Insurance Vault: ${vaultBalance.value.uiAmountString}`);

		process.exit(0);
	},
).argv;

yargs(hideBin(process.argv)).command(
	'show-top-positions <group> <symbol>',
	'Print top 10 positions for the symbol perp market',
	(y) => {
		return y.positional(...groupDesc).option(...configDesc);
	},
	async (args) => {
		console.log('show-top-positions', args);
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
		const mangoAccounts = await client.getAllMangoAccounts(
			mangoGroup,
			[],
			false,
		);

		const mangoCache = await mangoGroup.loadCache(connection);

		mangoAccounts.sort((a, b) =>
			b.perpAccounts[perpMarketConfig.marketIndex].basePosition
				.abs()
				.cmp(a.perpAccounts[perpMarketConfig.marketIndex].basePosition.abs()),
		);

		for (let i = 0; i < 10; i++) {
			console.log(
				`${i}: ${mangoAccounts[i].toPrettyString(
					groupConfig,
					mangoGroup,
					mangoCache,
				)}\n`,
			);
		}

		process.exit(0);
	},
).argv;

yargs(hideBin(process.argv)).command(
	'get-mango-account-by-oo <group> <oo_account_pk>',
	'Print top 10 positions for the symbol perp market',
	(y) => {
		return y.positional(...groupDesc).option(...configDesc);
	},
	async (args) => {
		console.log('show-top-positions', args);
		const config = readConfig(args.config as string);
		const groupConfig = config.getGroupWithName(
			args.group as string,
		) as GroupConfig;

		const connection = openConnection(config, groupConfig.cluster);

		const client = new MangoClient(connection, groupConfig.mangoProgramId);
		const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
		const mangoAccounts = await client.getAllMangoAccounts(
			mangoGroup,
			[],
			false,
		);

		const mangoAccount = mangoAccounts.find((ma) =>
			ma.spotOpenOrders.find((x) =>
				x.equals(new PublicKey(args.oo_account_pk as string)),
			),
		);
		const mangoCache = await mangoGroup.loadCache(connection);

		console.log(
			mangoAccount?.toPrettyString(groupConfig, mangoGroup, mangoCache),
		);

		process.exit(0);
	},
).argv;

yargs(hideBin(process.argv)).command(
	'show-top-spot-positions <group> <symbol> <deposits_or_borrows>',
	'Print top 10 positions for the symbol perp market',
	(y) => {
		return y.positional(...groupDesc).option(...configDesc);
	},
	async (args) => {
		console.log('show-top-positions', args);
		const config = readConfig(args.config as string);
		const groupConfig = config.getGroupWithName(
			args.group as string,
		) as GroupConfig;

		const marketIndex: number = throwUndefined(
			getMarketIndexBySymbol(groupConfig, args.symbol as string),
		);

		const connection = openConnection(config, groupConfig.cluster);
		const client = new MangoClient(connection, groupConfig.mangoProgramId);
		const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
		const mangoAccounts = await client.getAllMangoAccounts(
			mangoGroup,
			[],
			false,
		);

		mangoAccounts.sort((a, b) =>
			b[args.deposits_or_borrows as string][marketIndex]
				.abs()
				.cmp(a[args.deposits_or_borrows as string][marketIndex].abs()),
		);

		const mangoCache = await mangoGroup.loadCache(connection);
		for (let i = 0; i < 10; i++) {
			console.log(
				`${i}: ${mangoAccounts[i].toPrettyString(
					groupConfig,
					mangoGroup,
					mangoCache,
				)}\n`,
			);
		}

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

// e.g. yarn cli set-delegate mainnet.1 <mango-account-pk> <delegate-pk> \
// --keypair ~/.config/solana/<mango-account-owner-keypair>.json \
// --config src/ids.json --cluster mainnet
yargs(hideBin(process.argv)).command(
	'set-delegate <group> <mango_account> <delegate>',
	'support setting a delegate as a signer for a mango account',
	(y) => {
		return y
			.positional(...groupDesc)
			.positional('mango_account', {
				describe: 'the public key of the mango account',
				type: 'string',
			})
			.positional('delegate_pk', {
				describe: 'the public key of the delegate',
				type: 'string',
			})
			.option(...clusterDesc)
			.option(...configDesc)
			.option(...keypairDesc);
	},
	async (args) => {
		console.log('set-delegate', args);

		const account = readKeypair(args.keypair as string);
		const mangoAccountPk = new PublicKey(args.mango_account as string);
		const delegatePk = new PublicKey(args.delegate as string);
		const config = readConfig(args.config as string);
		const cluster = args.cluster as Cluster;

		const connection = openConnection(config, cluster);
		const groupConfig = config.getGroup(
			cluster,
			args.group as string,
		) as GroupConfig;
		const client = new MangoClient(connection, groupConfig.mangoProgramId);
		const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
		const mangoAccount = await client.getMangoAccount(
			mangoAccountPk,
			groupConfig.serumProgramId,
		);
		await client.setDelegate(mangoGroup, mangoAccount, account, delegatePk);
		process.exit(0);
	},
).argv;

// e.g. yarn cli change-spot-market-params devnet.3 MNGO \
// --keypair ~/.config/solana/mango-devnet-admin.json \
// --maint_leverage 2.5 --init_leverage 1.25 --liquidation_fee 0.2 \
// --cluster devnet
//
// to view change do, SYMBOL=MNGO CLUSTER=devnet GROUP=devnet.3 yarn \
// ts-node src/markets.ts
yargs(hideBin(process.argv)).command(
	'change-spot-market-params <group> <symbol>',
	'change params for a spot market',
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
			.option('optimal_util', {
				type: 'number',
			})
			.option('optimal_rate', {
				type: 'number',
			})
			.option('max_rate', {
				type: 'number',
			})
			.option(...clusterDesc)
			.option(...configDesc)
			.option(...keypairDesc);
	},
	async (args) => {
		console.log('change-spot-market-params', args);
		const account = readKeypair(args.keypair as string);
		const config = readConfig(args.config as string);
		const cluster = args.cluster as Cluster;
		const connection = openConnection(config, cluster);
		const groupConfig = config.getGroup(
			cluster,
			args.group as string,
		) as GroupConfig;

		const client = new MangoClient(connection, groupConfig.mangoProgramId);

		const symbol = args.symbol as string;
		const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
		const spotMarketConfig: SpotMarketConfig = throwUndefined(
			getSpotMarketByBaseSymbol(groupConfig, symbol),
		);
		const spotMarket = await Market.load(
			connection,
			spotMarketConfig.publicKey,
			undefined,
			groupConfig.serumProgramId,
		);

		const rootBanks = await mangoGroup.loadRootBanks(connection);
		const tokenBySymbol = getTokenBySymbol(groupConfig, symbol);
		const tokenIndex = mangoGroup.getTokenIndex(tokenBySymbol.mintKey);
		const rootBank = rootBanks[tokenIndex];

		if (!rootBank) {
			console.log('Root bank cannot be undefined!', args);
			process.exit(1);
		}

		await client.changeSpotMarketParams(
			mangoGroup,
			spotMarket,
			rootBank,
			account,
			getNumberOrUndef(args, 'maint_leverage'),
			getNumberOrUndef(args, 'init_leverage'),
			getNumberOrUndef(args, 'liquidation_fee'),
			getNumberOrUndef(args, 'optimal_util'),
			getNumberOrUndef(args, 'optimal_rate'),
			getNumberOrUndef(args, 'max_rate'),
			0,
		);
		process.exit(0);
	},
).argv;

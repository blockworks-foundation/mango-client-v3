// import BN from 'bn.js';
// import { Cluster, Config, MangoClient } from '../src';
// import fs from 'fs';
// import os from 'os';
// import { Cluster, Config } from './config';
// import configFile from './ids.json';
// import { Account, Commitment, Connection } from '@solana/web3.js';
//
// async function testMaxCompute() {
//   const groupName = process.env.GROUP || 'mango_test_v3.6';
//   const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
//   const config = new Config(configFile);
//   const groupIds = config.getGroup(cluster, groupName);
//
//   if (!groupIds) {
//     throw new Error(`Group ${groupName} not found`);
//   }
//   const mangoProgramId = groupIds.mangoProgramId;
//   const mangoGroupKey = groupIds.publicKey;
//   const payer = new Account(
//     JSON.parse(
//       process.env.KEYPAIR ||
//         fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
//     ),
//   );
//   const connection = new Connection(
//     config.cluster_urls[cluster],
//     'processed' as Commitment,
//   );
//
//   const client = new MangoClient(connection, mangoProgramId);
//   const mangoGroup = await client.getMangoGroup(mangoGroupKey);
//
//   // Load all the details for mango group
//   // create a new mango account
//   // deposit USDC
//   // place an order on 10 different spot markets
//   // place an order in 32 different perp markets
// }
//
// testMaxCompute();

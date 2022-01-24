import { Coder } from '@project-serum/anchor';
import idl from '../src/mango_logs.json';
import configFile from '../src/ids.json';
import { Cluster, Config } from '../src';

async function main() {
  const config = new Config(configFile);
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const groupName = process.env.GROUP || 'devnet.2';
  const groupIds = config.getGroup(cluster, groupName);
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }

  // @ts-ignore
  const coder = new Coder(idl);

  // Parse entire logs
  // const logs = [];
  // const parser = new EventParser(groupIds.mangoProgramId, coder);
  // parser.parseLogs(logs, (event) => console.log(event));

  // Parse a single log.
  const logs = [
    '9qpXciJ+y8R43ogDQe0xql0u2Ff66cc9XSGzkyyZdqoGDHUXDByC3VoBWmiMqeN6rTCF5rCtQwISKrwVwxJTEMLJwfBnQf3pAwAAAAAAAAAAAAAAAAAAAA==',
  ];

  for (const log of logs) {
    const event = coder.events.decode(log);
    // if (event && event.data.oraclePrices) {
    //   // @ts-ignore
    //   for (const priceBn of event.data.oraclePrices) {
    //     const price = new I80F48(priceBn).toNumber();
    //     console.log(price);
    //   }
    // }
    console.log(event);
  }
}

main();

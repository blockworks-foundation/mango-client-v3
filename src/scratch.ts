import { Coder } from '@project-serum/anchor';
import idl from './mango_logs.json';
import configFile from './ids.json';
import { Cluster, Config } from './config';

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
    'cp1to4/ecqbKISAtTF7lMdQarmxDZG/wXw1EdsMrRmiMvKrmbhkiIToETXVmfU+d+lCK9lac/zeF93GcHTUpE/5m0bOeQyJmAwAAAAAAAAACAAAAkdLL//////9PSQAAAAAAAG8tNAAAAAAA2FgAAAAAAAACAAAAkdLL//////9PSQAAAAAAAG8tNAAAAAAA2FgAAAAAAAA=',
    '9qpXciJ+y8TKISAtTF7lMdQarmxDZG/wXw1EdsMrRmiMvKrmbhkiIToETXVmfU+d+lCK9lac/zeF93GcHTUpE/5m0bOeQyJmAwAAAAAAAAAAAAAAAAAAAA==',
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

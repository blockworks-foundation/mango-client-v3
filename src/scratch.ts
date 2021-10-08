import { Coder } from '@project-serum/anchor';
import idl from './mango_logs.json';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { I80F48 } from './fixednum';

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
    'lhcplJii10DKISAtTF7lMdQarmxDZG/wXw1EdsMrRmiMvKrmbhkiIQABAFvkVGEAAAAAxi0BAAAAAAC4kVf55PTy0BmUBbr41IxHf1A9JU8WSrCUWGSI8WTJlDZfEAAAAAAAF1AGAAAAAACA+ZszfAEAAAAAAAAAAAAAAAAAAAAAAADAtgYAAAAAAFjkVGEAAAAARuIL33wGLo2fQ4HMUgyFM8qr6nKFpEX/UaC1A8l4kMPEoO///////yOhBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF1AGAAAAAAABAAAAAAAAAA==',
    'F5qwwQsqqPTKISAtTF7lMdQarmxDZG/wXw1EdsMrRmiMvKrmbhkiIUbiC998Bi6Nn0OBzFIMhTPKq+pyhaRF/1GgtQPJeJDDDwAAAAAAAAAOFBvX6NFKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'ux0uSxX5tBvKISAtTF7lMdQarmxDZG/wXw1EdsMrRmiMvKrmbhkiIQcAAAAAAAAAAAAAAAEAAAAAAAAAAgAAAAAAAAADAAAAAAAAAAQAAAAAAAAABQAAAAAAAAAGAAAAAAAAAAcAAADhehSuR00AAAAAAAAAAAAALbKd76cG8qAAAAAAAAAAANk9eViopQMLAAAAAAAAAABjeVc9YCIAAAAAAAAAAAAAq63YX3bnBgAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAACqz9VW7P8AAAAAAAAAAAAA',
    'V4pUNuOCxqzKISAtTF7lMdQarmxDZG/wXw1EdsMrRmiMvKrmbhkiIUbiC998Bi6Nn0OBzFIMhTPKq+pyhaRF/1GgtQPJeJDDAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
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

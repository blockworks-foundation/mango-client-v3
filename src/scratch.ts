import { EventParser, Coder } from '@project-serum/anchor';
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

  const parser = new EventParser(groupIds.mangoProgramId, coder);

  const log =
    'lhcplJii10AAAAAuxlRhAAAAAAQAAAAAAAAAEaTgBVAsMK+4t/hzfRgNDJwTGO6jdXwtkch0vmE/c4+1xQYAAAAAAC8zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALzMAAAAAAAC7O1NhAAAAAEbiC998Bi6Nn0OBzFIMhTPKq+pyhaRF/1GgtQPJeJDDhR/5//////++NQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8zAAAAAAAAAQAAAAAAAAA=';

  // Parse a single log.
  const x = coder.events.decode(log);
  console.log(x);
}
main();

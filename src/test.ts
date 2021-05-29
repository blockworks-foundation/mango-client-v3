import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { MerpsCacheLayout } from './layout';

async function test() {
    const merpsProgramId = new PublicKey('EBXaJhhjhRKYDRNwHUgqJhMDWGNqKwpwD3sYkXRN9Yuz');
    const dexProgramId = new PublicKey('DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY')
    const payer = new Account(JSON.parse(fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8')));
    const connection = new Connection('https://devnet.solana.com', 'processed' as Commitment)
    const client = new MerpsClient(connection, merpsProgramId);

    const quoteMintKey = new PublicKey('H6hy7Ykzc43EuGivv7VVuUKNpKgUoFAfUY3wdPr4UyRX');
    const groupKey = await client.initMerpsGroup(
        payer,
        quoteMintKey,
        dexProgramId,
        5
    );
    console.log('Group Created:', groupKey.toBase58());
}

test();
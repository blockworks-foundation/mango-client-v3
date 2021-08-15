import { PublicKey } from '@solana/web3.js';

async function verify(
  programId: PublicKey,
  realm: PublicKey,
  tokenAccount: PublicKey,
) {
  const [address, nonce] = await PublicKey.findProgramAddress(
    [
      Buffer.from('token-governance', 'utf-8'),
      realm.toBuffer(),
      tokenAccount.toBuffer(),
    ],
    programId,
  );

  console.log(address.toBase58());
}

const dao_program_id = new PublicKey(
  'GqTPL6qRf5aUuqscLh8Rg2HTxPUXfhhAXDptTLhp1t2J',
);
const realm = new PublicKey('DPiH3H3c7t47BMxqTxLsuPQpEC6Kne8GA9VXbxpnZxFE');
const tokenAccount = new PublicKey(
  '4PdEyhrV3gaUj4ffwjKGXBLo42jF2CQCCBoXenwCRWXf',
);

verify(dao_program_id, realm, tokenAccount);

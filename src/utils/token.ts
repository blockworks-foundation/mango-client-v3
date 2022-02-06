import { Connection, PublicKey } from '@solana/web3.js';
import { TokenInstructions } from '@project-serum/serum';
import { TokenAccountLayout } from '../layout';

export class TokenAccount {
  publicKey!: PublicKey;
  mint!: PublicKey;
  owner!: PublicKey;
  amount!: number;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }
}

function parseTokenResponse(r): TokenAccount[] {
  return r.value.map(
    ({ pubkey, account }) =>
      new TokenAccount(pubkey, TokenAccountLayout.decode(account.data)),
  );
}

export async function getTokenAccountsByOwnerWithWrappedSol(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenAccount[]> {
  const solReq = connection.getAccountInfo(owner);
  const tokenReq = connection.getTokenAccountsByOwner(owner, {
    programId: TokenInstructions.TOKEN_PROGRAM_ID,
  });

  // fetch data
  const [solResp, tokenResp] = await Promise.all([solReq, tokenReq]);

  // parse token accounts
  const tokenAccounts = parseTokenResponse(tokenResp);
  // create fake wrapped sol account to reflect sol balances in user's wallet
  const solAccount = new TokenAccount(owner, {
    mint: TokenInstructions.WRAPPED_SOL_MINT,
    owner,
    amount: solResp?.lamports || 0,
  });

  // prepend SOL account to beginning of list
  return [solAccount].concat(tokenAccounts);
}

export async function findLargestTokenAccountForOwner(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<TokenAccount> {
  const response = await connection.getTokenAccountsByOwner(
    owner,
    { mint },
    connection.commitment,
  );
  let maxTokenAccount: null | TokenAccount = null;
  for (const acc of parseTokenResponse(response)) {
    if (!maxTokenAccount || acc.amount > maxTokenAccount.amount) {
      maxTokenAccount = acc;
    }
  }

  if (!maxTokenAccount) {
    throw new Error('No accounts for this token');
  }

  return maxTokenAccount;
}

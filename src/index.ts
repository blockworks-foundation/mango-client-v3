import { makeInitMerpsGroupInstruction, makeTestMultiTxInstruction } from './instruction';
import { Account, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { createAccountInstruction } from './utils';
import { homedir } from 'os';
import fs from 'fs';
import { getUnixTs, sendTransaction, sendTransactions } from './client';

const MAX_TOKENS = 64

async function tests() {
  const keyPairPath = process.env.KEYPAIR || homedir() + '/.config/solana/id.json'
  const payer = new Account(JSON.parse(fs.readFileSync(keyPairPath, 'utf-8')))
  const programId = new PublicKey("4icah3bpkN6PhwqNBnUZJmfnxjz4UPB9HwS8KrYqebjQ")
  // const connection = new Connection("https://devnet.solana.com", "singleGossip")
  // const merpsGroupPk = new PublicKey("96ZfdPjhLkpuxJk92htKa4tiCXJpcqkwR1C6NPrKRu9N")

  const connection = new Connection("https://solana-api.projectserum.com", "singleGossip")
  const merpsGroupPk = new PublicKey("GWtwZF4DWCQ6QQv1zCL4vsXuBch2LWxkuiCg8Eergnrt")

  async function testInitMerpsGroup() {
    const accInstr = await createAccountInstruction(connection, payer.publicKey, 24, programId)
    const initInstr = makeInitMerpsGroupInstruction(programId, accInstr.account.publicKey)
    const transaction = new Transaction()
    transaction.add(accInstr.instruction)
    transaction.add(initInstr)
    const additionalSigners = [accInstr.account]
    const x = await sendTransaction(connection, transaction, payer, additionalSigners, 30000, 'processed')
    console.log("Merps Group PublicKey:", accInstr.account.publicKey.toBase58())
  }

  async function testMultiTx() {

    const transactions: Transaction[] = []
    for (let i = 0; i < MAX_TOKENS; i++) {
      const transaction = new Transaction()
      transaction.add(makeTestMultiTxInstruction(programId, merpsGroupPk, i))
      transactions.push(transaction)
    }

    const t0 = getUnixTs()
    await sendTransactions(connection, transactions, payer, [], 30000, 'processed')
    console.log(`full latency: ${getUnixTs() - t0}`)
  }
  // testInitMerpsGroup()
  testMultiTx()
}

tests()
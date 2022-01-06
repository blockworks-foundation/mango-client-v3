import { OpenOrders } from '@project-serum/serum';
import { PublicKey } from '@solana/web3.js';
import { MangoGroup, RootBank } from '../src';
import { MangoAccountLayout, MangoCache, MangoCacheLayout, MangoGroupLayout, NodeBank, NodeBankLayout, RootBankLayout } from '../src/layout';
import MangoAccount from '../src/MangoAccount';

export function loadTestMangoGroup(filename: string): MangoGroup {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = MangoGroupLayout.decode(data)
  return new MangoGroup(new PublicKey(accountJson.address), layout)
}

export function loadTestMangoAccount(filename: string): MangoAccount {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = MangoAccountLayout.decode(data)
  return new MangoAccount(new PublicKey(accountJson.address), layout)
}

export function loadTestOpenOrders(filename: string): OpenOrders {
  const openOrdersJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(openOrdersJson.data[0], 'base64');
  const layout = OpenOrders.getLayout(new PublicKey(0)).decode(data)
  return new OpenOrders(new PublicKey(openOrdersJson.address), layout, new PublicKey(0))
}

export function loadTestMangoCache(filename: string): MangoCache {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = MangoCacheLayout.decode(data)
  return new MangoCache(new PublicKey(accountJson.address), layout)
}

export function loadTestMangoRootBank(filename: string): RootBank {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = RootBankLayout.decode(data)
  return new RootBank(new PublicKey(accountJson.address), layout)
}

export function loadTestMangoNodeBank(filename: string): NodeBank {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = NodeBankLayout.decode(data)
  return new NodeBank(new PublicKey(accountJson.address), layout)
}

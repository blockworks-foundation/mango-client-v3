# Mango v3 Client Library

JavaScript client library for interacting with Mango Markets DEX v3.

## Installation

Using npm:

```
npm install @blockworks-foundation/mango-client
```

Using yarn:

```
yarn add @blockworks-foundation/mango-client
```

## Usage Example

This example assumes that you have a wallet that is already setup with devnet tokens. The private key should be stored in `~/.config/solana/devnet.json`. Visit https://v3.mango.markets/ and connect with the wallet to fund your margin account so that you can place orders. You can find the full source code in [example.ts](./src/example.ts).

```js
// Fetch orderbooks
const bids = await perpMarket.loadBids(connection);
const asks = await perpMarket.loadAsks(connection);

// L2 orderbook data
for (const [price, size] of bids.getL2(20)) {
  console.log(price, size);
}

// L3 orderbook data
for (const order of asks) {
  console.log(
    order.owner.toBase58(),
    order.orderId.toString('hex'),
    order.price,
    order.size,
    order.side, // 'buy' or 'sell'
  );
}

// Place order
await client.placePerpOrder(
  mangoGroup,
  mangoAccount,
  mangoGroup.mangoCache,
  perpMarket,
  owner,
  'buy', // or 'sell'
  39000,
  0.0001,
  'limit', // or 'ioc' or 'postOnly'
);

// retrieve open orders for account
const openOrders = await perpMarket.loadOrdersForAccount(
  connection,
  mangoAccount,
);

// cancel orders
for (const order of openOrders) {
  await client.cancelPerpOrder(
    mangoGroup,
    mangoAccount,
    owner,
    perpMarket,
    order,
  );
}

// Retrieve fills
for (const fill of await perpMarket.loadFills(connection)) {
  console.log(
    fill.owner.toBase58(),
    fill.maker ? 'maker' : 'taker',
    fill.baseChange.toNumber(),
    fill.quoteChange.toNumber(),
    fill.longFunding.toFixed(3),
    fill.shortFunding.toFixed(3),
  );
}
```

## CLI for testing

Create a new mango group on devnet:
```
init-group <group> <mangoProgramId> <serumProgramId> <quote_mint>
```
```
yarn cli init-group mango_test_v2.2 66DFouNQBY1EWyBed3WPicjhwD1FoyTtNCzAowcR8vad DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY EMjjdsqERN4wJUR9jMBax2pzqQPeGLNn5NeucbHpDUZK
```


Create a new mango group on devnet with new USDC:
```
init-group <group> <mangoProgramId> <serumProgramId> <quote_mint>
```
```
yarn cli init-group mango_test_v3.1 Hm3U4wFaR66SmuXj66u9AuUNUqa6T8Ldb5D9uHBs3SHd DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY 3u7PfrgTAKgEtNhNdAD4DDmNGfYfv5djGAPixGgepsPp
```


Add a stub oracle:
```
add-oracle <group> <symbol>
```
```
yarn cli add-oracle mango_test_v2.2 BTC
```


Add a pyth oracle:
```
add-oracle <group> <symbol>
```
```
yarn cli add-oracle mango_test_v3.1 BTC --provider pyth
```


Set stub oracle value = base_price \* quote_unit / base_unit:
```
set-oracle <group> <symbol> <value>
```
```
yarn cli set-oracle mango_test_v2.2 BTC 40000
```


Add a spot-market with existing serum market
```
add-spot-market <group> <symbol> <mint_pk> --market_pk <market_pk>
```
```
yarn cli add-spot-market mango_test_v2.2 BTC bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP --market_pk E1mfsnnCcL24JcDQxr7F2BpWjkyy5x2WHys8EL2pnCj9
```

List and add a spot-market
```
add-spot-market <group> <symbol> <mint_pk> --base_lot_size <number> --quote_lot_size <number>
```
```
yarn cli add-spot-market mango_test_v2.2 BTC bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP --base_lot_size 100 --quote_lot_size 10
```


Enable a perp-maket
```
add-perp-market <group> <symbol>
```
```
yarn cli add-perp-market mango_test_v2.2 BTC
```

## Run the Keeper
Update the `groupName` in `src/keeper.ts` and then run:

```
yarn keeper
```

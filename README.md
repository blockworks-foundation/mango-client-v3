# Mango v3 TS Client Library

JavaScript client library for interacting with Mango Markets DEX v3.

## Installation

Using npm:

```
npm install @solana/web3.js @project-serum/serum @blockworks-foundation/mango-client-ts
```

Using yarn:

```
yarn add @solana/web3.js @project-serum/serum @blockworks-foundation/mango-client-ts
```

## Usage Example

This example assumes that you have a wallet that is already setup with devnet tokens. The private key should be stored in `~/.config/solana/devnet.json`. Visit https://v3.mango.markets/ and connect with the wallet to fund your margin account so that you can place orders. You can find the full source code in [example.ts](./src/example.ts).

```
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
    merpsGroup,
    mangoAccount,
    merpsGroup.merpsCache,
    perpMarket,
    owner,
    'buy', // or 'sell'
    39000,
    0.0001,
    'limit',
  ); // or 'ioc' or 'postOnly'

  // retrieve open orders for account
  const openOrders = await perpMarket.loadOrdersForAccount(
    connection,
    mangoAccount,
  );

  // cancel orders
  for (const order of openOrders) {
    await client.cancelPerpOrder(
      merpsGroup,
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

Create a new merps group on devnet:

```
yarn cli -- init-group merps_test_v2.2 66DFouNQBY1EWyBed3WPicjhwD1FoyTtNCzAowcR8vad DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY EMjjdsqERN4wJUR9jMBax2pzqQPeGLNn5NeucbHpDUZK
```

Add a stub oracle:

```
yarn cli -- add-oracle merps_test_v2.2 BTC
```

Set stub oracle value = base_price \* quote_unit / base_unit:

```
yarn cli -- set-oracle merps_test_v2.2 BTC 40000
```

Add a spot-market

```
yarn cli -- add-spot-market merps_test_v2.2 BTC E1mfsnnCcL24JcDQxr7F2BpWjkyy5x2WHys8EL2pnCj9 bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP
```

Enable a perp-maket

```
yarn cli -- add-perp-market merps_test_v2.2 BTC
```

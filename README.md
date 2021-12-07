# Mango v3 Client Library

JavaScript client library for interacting with Mango Markets DEX v3.

[API Documentation](https://blockworks-foundation.github.io/mango-client-v3/)

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
1. Install Node.js and npm (https://nodejs.org/en/download/), and Git (https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
2. Open a new terminal window (if running Windows use Git Bash) and run `npm install -g yarn`
3. Run `git clone https://github.com/blockworks-foundation/mango-client-v3.git && cd mango-client-v3` to get the client source code
5. Run `yarn install` to install dependencies
6. Set the KEYPAIR env variable (e.g. `export KEYPAIR=$(cat ~/.config/solana/id.json)`, or copy from Sollet)
8. Run `yarn keeper` to start the Keeper

Example: 
```
KEYPAIR=[123, 456, 789, ...] yarn keeper
```

## Run the Market Maker
### Setup
To run the market maker you will need:
* A Solana account with some SOL deposited to cover transaction fees
* A Mango Account with some collateral deposited and a name (tip: use the UI)
* Your wallet keypair saved as a JSON file
* `node` and `yarn`
* A clone of this repository
* Dependencies installed with `yarn install`

### Environment Variables
| Variable | Default | Description |
| -------- | ------- | ----------- |
| `ENDPOINT_URL` | `https://mango.rpcpool.com` | Your RPC node endpoint |
| `KEYPAIR` | `${HOME}/.config/solana/id.json` | The location of your wallet keypair |
| `GROUP` | `mainnet.1` | Name of the group in ids.json |
| `INTERVAL` | `10000` | Milliseconds to wait before checking for sick accounts |
| `MANGO_ACCOUNT_NAME` | N/A | The MangoAccount name you input when initializing the MangoAccount via UI |
| `MANGO_ACCOUNT_PUBKEY` | N/A | If no MangoAccount name, just pass in the pubkey |
| `MARKET` | N/A | Market base symbol e.g. BTC |
| `SIZE_PERC` | `0.1` | The size of each order as a percentage of equity |
| `CHARGE` | `0.0010` | Half the quote width |
| `LEAN_COEFF` | `0.0005` | How much to move the quotes per unit size of inventory |
| `BIAS` | `0` | Fixed amount to bias. Negative values bias downward. e.g. -0.0005 biases down 5bps |

### Example
```shell
git clone https://github.com/blockworks-foundation/mango-client-v3.git
cd mango-client-v3
yarn install
KEYPAIR=~/.config/solana/id.json GROUP=mainnet.1 MANGO_ACCOUNT_NAME=mm MARKET=ADA INTERVAL=5000 SIZE_PERC=0.05 CHARGE=0.0015 LEAN_COEFF=0.00075 yarn mm
```

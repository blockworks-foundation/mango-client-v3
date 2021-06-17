# merps-ts

Create a new merps group on devnet:

```
yarn cli -- init-group merps_v1 8XywrZebqGoRTYgK1zLoESRdPx6gviRQe6hMonQZbt7M DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY EMjjdsqERN4wJUR9jMBax2pzqQPeGLNn5NeucbHpDUZK
```

Add a stub oracle:

```
yarn cli -- add-oracle merps_v1 BTC
```

Set stub oracle value = base_price \* quote_unit / base_unit:

```
yarn cli -- set-oracle merps_v1 BTC 40000
```

Add a spot-market

```
yarn cli -- add-spot-market merps_v1 BTC E1mfsnnCcL24JcDQxr7F2BpWjkyy5x2WHys8EL2pnCj9 bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP
```

Enable a perp-maket

```
yarn cli -- add-perp-market merps_v1 BTC
```

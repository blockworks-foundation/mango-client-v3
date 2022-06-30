import {Config, getSpotMarketByBaseSymbol, getTokenBySymbol} from "../config";
import {Connection, Keypair, PublicKey, Transaction} from "@solana/web3.js";
import {MangoClient} from "../client";
import {getFeeRates, getFeeTier, Market} from "@project-serum/serum";
import fs from "fs";
import os from "os";
import {nativeToUi, ZERO_BN, zeroKey} from "../utils/utils";
import {
    makeCancelAllSpotOrdersInstruction,
    makeCreateSpotOpenOrdersInstruction,
    makePlaceSpotOrder2Instruction
} from "../instruction";
import {QUOTE_INDEX} from "../layout";
import {BN} from "bn.js";
import MangoGroup from "../MangoGroup";
import MangoAccount from "../MangoAccount";
import {Payer} from "../utils/types";

/*

Example command:
KEYPAIR_PATH=~/.config/solana/id.json MANGO_ACCOUNT=YOUR_MANGO_ACCOUNT yarn ts-node src/scripts/serumExampleMarketMaker.ts

This is a simple market maker bot that quotes on Serum markets supported by Mango.
It showcases the instructions needed to create limit orders and cancel them, all
in one transaction.

To test it, you'll need:
- A Solana account with some SOL deposited to cover transaction fees
- A Mango account with some collateral deposited
- Your wallet keypair saved as a JSON file

In mainnet:

If you've got the aforementioned prerequisites covered already, run the example command with the params that
correspond to you.


In devnet:

You'll need to airdrop SOL to your account. First generate a keypair if you haven't already,
by installing the Solana CLI tools as per https://docs.solana.com/cli/install-solana-cli-tools
and then generating a keypair using `solana-keygen new`.

Airdrop some SOL to it using `solana airdrop -v --url devnet 1` - deposit some of it as
collateral through the UI at https://devnet.mango.markets/?name=MNGO/USDC

Finally execute the example command. You should see the orders quoted by the bot in the UI's orderbook.


Meta learning resources:

A technical introduction to the Serum DEX: https://docs.google.com/document/d/1isGJES4jzQutI0GtQGuqtrBUqeHxl_xJNXdtOv4SdII
At the time of writing, all but information regarding the "Request Queue" is valid (the Request Queue doesn't exist anymore)

Very simple market making bot for perps, which served as a model for this spot market maker:
https://github.com/blockworks-foundation/mango-client-v3/blob/main/src/scripts/benchmarkOrders.ts

*/

const {
    KEYPAIR_PATH,
    MANGO_ACCOUNT
} = process.env

async function main() {
    const config = Config.ids()

    const mangoGroupConfig = config.getGroupWithName('mainnet.1')

    // Temporarily hardcoded to mainnet given that I can't get it to work on devnet yet because
    // of an error similar to https://github.com/blockworks-foundation/market-maker-ts/issues/3

    if (!mangoGroupConfig) {
        return
    }

    const connection = new Connection(config.cluster_urls[mangoGroupConfig.cluster], 'processed')

    const mangoClient = new MangoClient(connection, mangoGroupConfig.mangoProgramId)

    const mangoGroup = await mangoClient.getMangoGroup(mangoGroupConfig.publicKey)

    const rootBank = mangoGroup.loadRootBanks(connection)

    const mangoCache = await mangoGroup.loadCache(connection)

    const spotMarketConfig = getSpotMarketByBaseSymbol(mangoGroupConfig, 'MNGO')

    if (!spotMarketConfig) {
        return
    }

    const token = getTokenBySymbol(mangoGroupConfig, 'MNGO')

    let tokenPrice: number | undefined

    tokenPrice = mangoGroup.cachePriceToUi(
        mangoCache.getPrice(mangoGroup.getTokenIndex(token.mintKey)), mangoGroup.getTokenIndex(token.mintKey)
    )

    mangoGroup.onCacheChange(connection, (mangoCache) => {
        tokenPrice = mangoGroup.cachePriceToUi(
            mangoCache.getPrice(mangoGroup.getTokenIndex(token.mintKey)), mangoGroup.getTokenIndex(token.mintKey)
        )
    })

    const spotMarket = await Market.load(
        connection,
        spotMarketConfig.publicKey,
        undefined,
        mangoGroupConfig.serumProgramId
    )

    console.log(MANGO_ACCOUNT!)

    const mangoAccount = await mangoClient.getMangoAccount(
        new PublicKey(MANGO_ACCOUNT!),
        mangoGroupConfig.serumProgramId
    )

    const payer = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH!, 'utf-8')))
    )

    const quote = async () => {
        const latestBlockhash = await connection.getLatestBlockhash('finalized')

        const spread = tokenPrice! * 0.03

        const bidPrice = tokenPrice! - spread

        const askPrice = tokenPrice! + spread

        // @ts-ignore
        const tx = new Transaction({
            recentBlockhash: latestBlockhash.blockhash,
            feePayer: payer.publicKey
        })

        const instructions = await Promise.all([
            cancelAllSpotOrdersInstruction(mangoClient, mangoGroup , mangoAccount, spotMarket, payer, 255),
            placeSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, 'buy', bidPrice, 10, 'limit', undefined, true),
            placeSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, 'sell', askPrice, 10, 'limit', undefined, true)
        ])

        // @ts-ignore
        tx.add(...instructions)

        tx.sign(payer)

        try {
          const resp = await mangoClient.sendSignedTransaction({
            signedTransaction: tx,
            signedAtBlock: latestBlockhash,
          });

          console.log('benchmark::response', resp);
        } catch (e: any) {
          console.log('benchmark::error', e);
        }
    }

    setInterval(quote, 333)
}

async function placeSpotOrder2Instruction(
    mangoClient: MangoClient,
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    spotMarket: Market,
    owner: Payer,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    // @ts-ignore
    clientOrderId?: BN,
    useMsrmVault?: boolean | undefined
) {
    if (!owner.publicKey) {
      return;
    }
    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);
    const allTransactions: Transaction[] = [];

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(mangoGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    if (!mangoGroup.rootBankAccounts.filter((a) => !!a).length) {
      await mangoGroup.loadRootBanks(mangoClient.connection);
    }
    let feeVault: PublicKey;
    if (useMsrmVault) {
      feeVault = mangoGroup.msrmVault;
    } else if (useMsrmVault === false) {
      feeVault = mangoGroup.srmVault;
    } else {
      const totalMsrm = await mangoClient.connection.getTokenAccountBalance(
        mangoGroup.msrmVault,
      );
      feeVault =
        totalMsrm?.value?.uiAmount && totalMsrm.value.uiAmount > 0
          ? mangoGroup.msrmVault
          : mangoGroup.srmVault;
    }

    const baseRootBank = mangoGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    const initTx = new Transaction();
    for (let i = 0; i < mangoAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (mangoAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          const spotMarketIndexBN = new BN(spotMarketIndex);
          const [openOrdersPk] = await PublicKey.findProgramAddress(
            [
              mangoAccount.publicKey.toBytes(),
              spotMarketIndexBN.toArrayLike(Buffer, 'le', 8),
              new Buffer('OpenOrders', 'utf-8'),
            ],
            mangoClient.programId,
          );

          const initOpenOrders = makeCreateSpotOpenOrdersInstruction(
            mangoClient.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            owner.publicKey,
            mangoGroup.dexProgramId,
            openOrdersPk,
            spotMarket.publicKey,
            mangoGroup.signerKey,
          );

          initTx.add(initOpenOrders);
          allTransactions.push(initTx);

          pubkey = openOrdersPk;
        } else {
          pubkey = mangoAccount.spotOpenOrders[i];
        }
      } else if (mangoAccount.inMarginBasket[i]) {
        pubkey = mangoAccount.spotOpenOrders[i];
      }

      // new design does not require zero keys to be passed in
      if (!pubkey.equals(zeroKey)) {
        openOrdersKeys.push({ pubkey, isWritable });
      }
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const placeOrderInstruction = makePlaceSpotOrder2Instruction(
      mangoClient.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      mangoGroup.signerKey,
      dexSigner,
      feeVault,
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientOrderId ?? new BN(Date.now()),
    );

    return placeOrderInstruction
  }

async function cancelAllSpotOrdersInstruction(
    mangoClient: MangoClient,
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    spotMarket: Market,
    owner: Payer,
    limit: number,
  ) {
    if(!owner.publicKey)
      return;

    const marketIndex = mangoGroup.getSpotMarketIndex(spotMarket.address);
    const baseRootBank = mangoGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];

    if (baseRootBank == null || quoteRootBank == null)
    {
      console.log("A root bank is null")

      return;
    }
    const baseNodeBanks = await baseRootBank.loadNodeBanks(mangoClient.connection);
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(mangoClient.connection);
    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const instruction = makeCancelAllSpotOrdersInstruction(
      mangoClient.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      mangoAccount.publicKey,
      owner.publicKey,
      baseRootBank.publicKey,
      baseNodeBanks[0].publicKey,
      baseNodeBanks[0].vault,
      quoteRootBank.publicKey,
      quoteNodeBanks[0].publicKey,
      quoteNodeBanks[0].vault,
      spotMarket.publicKey,
      spotMarket.bidsAddress,
      spotMarket.asksAddress,
      mangoAccount.spotOpenOrders[spotMarketIndex],
      mangoGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      dexSigner,
      mangoGroup.dexProgramId,
      new BN(limit),
    );

    return instruction;
  }

main()

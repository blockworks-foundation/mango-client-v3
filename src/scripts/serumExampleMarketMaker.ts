import {MangoClient} from "../client";
import {Connection, Keypair, PublicKey, Transaction} from "@solana/web3.js";
import {Config, getSpotMarketByBaseSymbol, getTokenBySymbol} from "../config";
import fs from "fs";
import os from "os";
import {getFeeRates, getFeeTier, Market} from "@project-serum/serum";
import {
    makeCancelAllSpotOrdersInstruction,
    makeCreateSpotOpenOrdersInstruction,
    makePlaceSpotOrder2Instruction
} from "../instruction";
import {BN} from "bn.js";
import { zip, range } from 'lodash'
import MangoGroup from "../MangoGroup";
import MangoAccount from "../MangoAccount";
import {Payer} from "../utils/types";
import {nativeToUi, sleep, ZERO_BN} from "../utils/utils";
import {QUOTE_INDEX} from "../layout";

/*

Example command:
KEYPAIR_PATH=~/.config/solana/id.json MANGO_GROUP=devnet.2 MANGO_ACCOUNT=YOUR_MANGO_ACCOUNT MARKETS=MNGO,BTC yarn ts-node src/scripts/serumExampleMarketMaker.ts

This is a simple market maker bot that quotes on Serum markets supported by Mango.
It showcases the instructions needed to create limit orders and cancel them, all
in one transaction.

Prerequisites:
- A Solana account with some SOL deposited to cover transaction fees
- A Mango account with some collateral deposited
- Your wallet keypair saved as a JSON file

In devnet:

You'll need to airdrop SOL to your account. First generate a keypair if you haven't already,
by installing the Solana CLI tools as per https://docs.solana.com/cli/install-solana-cli-tools
and then generating a keypair using `solana-keygen new`.

Airdrop some SOL to it using `solana airdrop -v --url devnet 1` - deposit some of it as
collateral through the UI at https://devnet.mango.markets/

Finally execute the example command. You should see the orders quoted by the bot in the UI's orderbook.

In mainnet:

If you've got the prerequisites covered already, run the example command changing MANGO_GROUP


Meta learning resources:

A technical introduction to the Serum DEX: https://docs.google.com/document/d/1isGJES4jzQutI0GtQGuqtrBUqeHxl_xJNXdtOv4SdII
At the time of writing, all but information regarding the "Request Queue" is valid (the Request Queue doesn't exist anymore)

Very simple market making bot for perps, which served as a model for this spot market maker:
https://github.com/blockworks-foundation/mango-client-v3/blob/main/src/scripts/benchmarkOrders.ts

*/

const main = async (market: string) => {
    const {
        KEYPAIR,
        KEYPAIR_PATH,
        MANGO_GROUP,
        MANGO_ACCOUNT,
    } = process.env

    const config = Config.ids()
    const mangoGroupConfig = config.getGroupWithName(MANGO_GROUP || 'devnet.2')

    if (!mangoGroupConfig) {
        console.log(`Couldn't find group by name ${MANGO_GROUP}`)

        return
    }

    const connection = new Connection(Config.ids().cluster_urls[mangoGroupConfig.cluster], 'processed')

    const mangoClient = new MangoClient(connection, mangoGroupConfig.mangoProgramId)

    const mangoGroup = await mangoClient.getMangoGroup(mangoGroupConfig.publicKey)

    const mangoCache = await mangoGroup.loadCache(connection)

    const rootBanks = await mangoGroup.loadRootBanks(connection)

    const payer = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(KEYPAIR || fs.readFileSync(KEYPAIR_PATH || os.homedir() + '/.config/solana/id.json', 'utf-8')))
    )

    const mangoAccount = await mangoClient.getMangoAccount(new PublicKey(MANGO_ACCOUNT!), mangoGroup.dexProgramId)

    const spotMarketConfig = getSpotMarketByBaseSymbol(mangoGroupConfig, market)

    if (!spotMarketConfig) {
        return
    }

    const token = getTokenBySymbol(mangoGroupConfig, spotMarketConfig.baseSymbol)

    let tokenPrice = mangoGroup.cachePriceToUi(
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

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey)

    if (!mangoAccount.spotOpenOrdersAccounts[spotMarketIndex]) {
        /*

        Unlike in perp markets, where orders require only a Mango account, Serum
        markets supported by Mango require an "open orders" account to serve as
        an intermediary. One open orders account is needed for each spot market.

        */

        console.log('Open orders account not found, creating one...')

        const spotMarketIndexBN = new BN(spotMarketIndex)

        const [openOrdersPk] = await PublicKey.findProgramAddress(
            [
                mangoAccount.publicKey.toBytes(),
                spotMarketIndexBN.toArrayLike(Buffer, 'le', 8),
                new Buffer('OpenOrders', 'utf-8'),
            ],
            mangoClient.programId,
        )

        const createSpotOpenOrdersInstruction = makeCreateSpotOpenOrdersInstruction(
            mangoClient.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            payer.publicKey,
            mangoGroup.dexProgramId,
            openOrdersPk,
            spotMarket.publicKey,
            mangoGroup.signerKey
        )

        const latestBlockhash = await connection.getLatestBlockhash('finalized')

        const tx = new Transaction({
            recentBlockhash: latestBlockhash.blockhash,
            feePayer: payer.publicKey
        })

        tx.add(createSpotOpenOrdersInstruction)

        tx.sign(payer)

        try {
            const response = await mangoClient.sendSignedTransaction({
                signedTransaction: tx,
                signedAtBlock: latestBlockhash
            })

            console.log('create_open_orders_account::response', response)
        } catch (error) {
            console.log('create_open_orders_account::error', error);
        }
        await sleep(2500);
        await mangoAccount.reload(connection, mangoGroup.dexProgramId)
        // ^ The newly created open orders account isn't immediately visible in
        // the already fetched Mango account, hence it needs to be reloaded

        console.log('Created open orders account!')
    }

    const quote = async () => {
        const latestBlockhash = await connection.getLatestBlockhash('finalized')
        // ^ Solana validators use this hash to determine when a transaction
        // might be considered "too old" and should be discarded, which is
        // why we send the most recent one each time.

        const tx = new Transaction({
            recentBlockhash: latestBlockhash.blockhash,
            feePayer: payer.publicKey
        })

        const spread = tokenPrice! * 0.03

        const bidPrice = tokenPrice! - spread

        const askPrice = tokenPrice! + spread

        // It's important to batch instructions in one transaction - this way we get
        // atomicity (if one instruction fails, the whole transaction is rolled back),
        // save on SOL costs and speed up quoting, since we don't need to make one
        // blockchain-client roundtrip per instruction.

        const instructions = await Promise.all([
            cancelAllSpotOrdersInstruction(mangoClient, mangoGroup , mangoAccount, spotMarket, payer, 255),
            createSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, 'buy', bidPrice, 10, 'limit', undefined, true),
            createSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, 'sell', askPrice, 10, 'limit', undefined, true)
        ])

        // @ts-ignore
        tx.add(...instructions)

        tx.sign(payer)

        try {
            const resp = await mangoClient.sendSignedTransaction({
                signedTransaction: tx,
                signedAtBlock: latestBlockhash,
            });

            console.log('quote::response::' + market.toLowerCase(), resp);
        } catch (error) {
            console.log('quote::error::' + market.toLowerCase(), error);
        }
    }

    setInterval(quote, 5000)
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


async function createSpotOrder2Instruction(
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

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index

    const openOrdersKeys = zip(mangoAccount.spotOpenOrdersAccounts, range(0, mangoAccount.spotOpenOrdersAccounts.length))
        .filter(([openOrdersAccount, index]) => mangoAccount.inMarginBasket[index!] || index == spotMarketIndex)
        .map(([openOrdersAccount, index]) => (
            {
                pubkey: openOrdersAccount!.publicKey,
                isWritable: index == spotMarketIndex
            }
        ))

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

const markets = process.env.MARKETS?.split(',');
if (markets && markets.length > 0 && markets.length < 7) {
  markets.forEach((market) => {
    main(market).catch((err) => {
    console.error('error in market', market, err);
    });
  });
} else {
  console.error('You must specify between 1 and 6 markets');
}
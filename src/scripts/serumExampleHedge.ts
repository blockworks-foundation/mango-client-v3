import {BlockhashWithExpiryBlockHeight, Connection, Keypair, PublicKey, Transaction} from "@solana/web3.js";
import fs from "fs";
import {BN} from "bn.js";
import {getFeeRates, getFeeTier, Market, OpenOrders} from "@project-serum/serum";
import _, {range, zip} from "lodash";
import WebSocket from "ws";
import {Payer} from "../utils/types";
import {getMultipleAccounts, I64_MAX_BN, nativeToUi, ZERO_BN, zeroKey} from "../utils/utils";
import {MangoClient} from "../client";
import {FillEvent, MangoAccountLayout, PerpEventLayout, PerpEventQueueLayout, QUOTE_INDEX} from "../layout";
import {Config, getPerpMarketByBaseSymbol, getSpotMarketByBaseSymbol, getTokenBySymbol} from "../config";
import {
    makeCancelAllPerpOrdersInstruction,
    makePlacePerpOrder2Instruction,
    makePlaceSpotOrder2Instruction
} from "../instruction";
import PerpEventQueue from "../PerpEventQueue";
import MangoGroup from "../MangoGroup";
import {performance} from "perf_hooks";
import MangoAccount from "../MangoAccount";
import {MangoRiskCheck, ViolationBehaviour} from "mango_risk_check";

// KEYPAIR=~/.config/solana/id.json MANGO_GROUP=devnet.2 MANGO_ACCOUNT=BFLAGijqDyRnK93scRizT8YSotrvdxhdJyWYZch6yMMW SYMBOL=SOL PERPS_FILLS_FEED=ws://api.mngo.cloud:2082 npx ts-node serumExampleHedge.ts

const main = async () => {
    const {
        MANGO_GROUP,
        KEYPAIR,
        MANGO_ACCOUNT,
        SYMBOL,
        PERPS_FILLS_FEED
    } = process.env

    const config = Config.ids()

    if (!MANGO_GROUP) {
        console.log('Attach a MANGO_GROUP env variable.')

        return
    }

    const mangoGroupConfig = config.getGroupWithName(MANGO_GROUP!)

    if (!mangoGroupConfig) {
        console.log(`Couldn't find group by name ${MANGO_GROUP}`)

        return
    }

    const [token, perpMarketConfig, spotMarketConfig] = [
        getTokenBySymbol(mangoGroupConfig, SYMBOL!),
        getPerpMarketByBaseSymbol(mangoGroupConfig, SYMBOL!),
        getSpotMarketByBaseSymbol(mangoGroupConfig, SYMBOL!)
    ]

    if (!token || !perpMarketConfig || !spotMarketConfig) {
        console.log(`token, perpMarketConfig or spotMarketConfig by symbol ${SYMBOL!} not found`)

        return
    }

    const connection = new Connection(config.cluster_urls[mangoGroupConfig.cluster], 'processed')
    // ^ See https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment
    // to learn more about each state commitment i.e processed, confirmed and finalized.

    const mangoClient = new MangoClient(connection, mangoGroupConfig.mangoProgramId)

    console.log('Loading Mango group...')

    const mangoGroup = await mangoClient.getMangoGroup(mangoGroupConfig.publicKey)

    console.log(`Loaded! ${(performance.now() / 1e3).toFixed(2)}s` )

    console.log('Loading mangoCache, rootBanks, perpMarket and spotMarket...')

    const [mangoCache, rootBanks, perpMarket, spotMarket] = await Promise.all([
        mangoGroup.loadCache(connection),
        mangoGroup.loadRootBanks(connection),
        mangoGroup.loadPerpMarket(
            connection,
            perpMarketConfig.marketIndex,
            perpMarketConfig.baseDecimals,
            perpMarketConfig.quoteDecimals
        ),
        Market.load(
            connection,
            spotMarketConfig.publicKey,
            undefined,
            mangoGroupConfig.serumProgramId
        )
    ])

    console.log(`Loaded! ${(performance.now() / 1e3).toFixed(2)}s` )

    console.log('Loading meta...')

    const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR!, 'utf-8'))))

    const mangoAccountPk = new PublicKey(MANGO_ACCOUNT!)

    const spotOpenOrdersPks = (await mangoClient.getMangoAccount(mangoAccountPk, mangoGroup.dexProgramId)).spotOpenOrders

    async function monitor(): Promise<[number, MangoAccount, PerpEventQueue, BlockhashWithExpiryBlockHeight, number]> {
        const [mangoAccountRaw, perpEventQueueRaw, ...spotOpenOrdersAccountsRaw] = await getMultipleAccounts(
            connection,
            [
                mangoAccountPk,
                perpMarketConfig!.eventsKey,
                ...spotOpenOrdersPks.filter(spotOpenOrderAccount => !spotOpenOrderAccount.equals(zeroKey))
            ],
        )

        const slot = mangoAccountRaw.context.slot

        const mangoAccount = new MangoAccount(mangoAccountPk, MangoAccountLayout.decode(mangoAccountRaw.accountInfo.data))

        mangoAccount.spotOpenOrdersAccounts = spotOpenOrdersPks.map((openOrderPk) => {
          if (openOrderPk.equals(zeroKey)) {
            return undefined;
          }
          const account = spotOpenOrdersAccountsRaw.find((a) => a.publicKey.equals(openOrderPk));
          return account
            ? OpenOrders.fromAccountInfo(
                openOrderPk,
                account.accountInfo,
                mangoGroup.dexProgramId,
              )
            : undefined;
        })

        const perpEventQueue = new PerpEventQueue(PerpEventQueueLayout.decode(perpEventQueueRaw.accountInfo.data))

        const recentBlockHash = await connection.getLatestBlockhash('finalized')
        // ^ Solana transactions require a recent block hash passed as metadata in order to be signed.
        // Instead of fetching this before dispatching every transaction (which would delay it by a
        // few milliseconds) we poll for this regularly in the background.

        const recentBlockTime = await connection.getBlockTime(
            await connection.getSlot('finalized')
        )

        return [slot, mangoAccount, perpEventQueue, recentBlockHash, recentBlockTime!]
    }

    let [
        slot,
        mangoAccount,
        perpEventQueue,
        recentBlockHash,
        recentBlockTime
    ] = await monitor()

    console.log(`Loaded! ${(performance.now() / 1e3).toFixed(2)}s` )
    // ^ This will be used to as reference for time in force orders later on.
    // It is important to use cluster time, like above, and not local time.

    setInterval(async () => {
        [
            slot,
            mangoAccount,
            perpEventQueue,
            recentBlockHash,
            recentBlockTime
        ] = await monitor()
    }, 5000)

    /*

    To interact with the (Serum) DEX, a given user must create an OpenOrders
    account. This account stores the following:
    - How much of the base and quote currency (in the SOL/USDC pair, SOL
      would be base currency and USDC would be quote) that user has locked
      in open orders or is settleable
    - A list of open orders for that user on that market

    */

    await mangoClient.ensureOpenOrdersAccount(mangoAccount, mangoGroup, payer, spotMarket, spotMarketConfig)

    console.log('Loading risk checker...')

    // The risk checker prevents long/short exposure & open orders from exceeding specific thresholds
    // https://github.com/Is0tope/mango_risk_check/blob/master/js/examples/example.ts
    const riskChecker = new MangoRiskCheck({
        connection: connection,
        mangoAccount: mangoAccount,
        mangoClient: mangoClient,
        mangoGroup: mangoGroup,
        owner: payer
    })

    try {
        await riskChecker.initializeRiskAccount(perpMarketConfig)
    } catch (error) {
        console.log(error)
    }

    try {
        await Promise.all([
            riskChecker.setMaxOpenOrders(perpMarketConfig, 2),
            riskChecker.setMaxLongExposure(perpMarketConfig, perpMarket, 5),
            riskChecker.setMaxShortExposure(perpMarketConfig, perpMarket, 5),
            riskChecker.setViolationBehaviour(perpMarketConfig, ViolationBehaviour.CancelIncreasingOrders)
        ])
    } catch (error) {
        console.log(error)
    }

    console.log('Loaded!')

    const tokenIndex = mangoGroup.getTokenIndex(token.mintKey)

    let [tokenPrice, tokenPriceLastUpdated] = [
        mangoGroup.cachePriceToUi(
            mangoCache.getPrice(tokenIndex), tokenIndex
        ),
        new Date()
        // ^ The "last updated" timestamp for the cached token oracle price is
        // logged to check whether it hasn't updated in too long of a while
    ]

    mangoGroup.onCacheChange(connection, (mangoCache) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        [tokenPrice, tokenPriceLastUpdated] = [
            mangoGroup.cachePriceToUi(
                mangoCache.getPrice(tokenIndex), tokenIndex
            ),
            new Date()
        ]
    })

    let recentFills: any[] = []

    function listenToFills() {
        const ws = new WebSocket(PERPS_FILLS_FEED!)

        ws.onopen = event => {
            console.log('Fills feed connection is open!')
        }

        ws.onmessage = async (message) => {
            const data = JSON.parse(message.data.toString());

            // eslint-disable-next-line no-prototype-builtins
            const isSnapshot = data.hasOwnProperty('events')

            const parseEvent = (event: string) =>
                PerpEventLayout.decode(Buffer.from(event, 'base64'))

            if (isSnapshot) {
                return
            } else {
                if (data.market.split('-')[0] !== SYMBOL) {
                    return
                }

                const event = parseEvent(data.event)

                const fill = perpMarket.parseFillEvent(event.fill)

                if (!(fill.maker.equals(mangoAccountPk))) {
                    return
                }

                const takerBase = perpMarket.baseLotsToNumber(mangoAccount.perpAccounts[perpMarketConfig!.marketIndex].takerBase)

                const basePosition = perpMarket.baseLotsToNumber(mangoAccount.perpAccounts[perpMarketConfig!.marketIndex].basePosition)

                const unprocessedFills = perpEventQueue.getUnconsumedEvents()
                    .filter(event => event.fill !== undefined)
                    .map(event => perpMarket.parseFillEvent(event.fill))
                    .filter(fill => fill.maker.equals(mangoAccount.publicKey)) as any[]

                const queuedBasePosition = unprocessedFills
                    .reduce((accumulator, fill) => {
                        switch (fill.takerSide) {
                            case "buy":
                                return accumulator - fill.quantity
                            case "sell":
                                return accumulator + fill.quantity
                        }
                    }, basePosition + takerBase)

                recentFills = [...recentFills, { ...fill, slot: data.slot }].filter(fill => fill.slot > slot)

                const completeBasePosition = queuedBasePosition + recentFills.reduce((accumulator, fill) => {
                        switch (fill.takerSide) {
                            case "buy":
                                return accumulator - fill.quantity
                            case "sell":
                                return accumulator + fill.quantity
                        }
                }, 0)

                console.log(unprocessedFills, recentFills, data.slot, slot, data.slot - slot, basePosition, takerBase, queuedBasePosition, completeBasePosition)
            }
        }

        ws.onclose = function (event) {
            console.log('Fills feed connection is closed. Reconnecting...', event.reason);

            listenToFills()
        };

        ws.onerror = (event) => {
            console.log(event)

            ws.close()
        }
    }

    listenToFills()

    const quote = async () => {
        // const spread = tokenPrice! * 0.0005

        const spread = 0.0005

        const [bidPriceUi, bidSizeUi] = [tokenPrice - spread, 0.1]

        const [askPriceUi, askSizeUi] = [tokenPrice + spread, 0.1]

        const [bidPrice, bidSize] = perpMarket.uiToNativePriceQuantity(bidPriceUi, bidSizeUi)

        const [askPrice, askSize] = perpMarket.uiToNativePriceQuantity(askPriceUi, askSizeUi)

        const tx = new Transaction({
            recentBlockhash: recentBlockHash.blockhash,
            feePayer: payer.publicKey
        })

        const timestamp = new BN(Date.now())

        // Use different order IDs for both sides of the quote - inconsistent state
        // issues on the program side might happen if we tried to cancel order by ID
        // otherwise.
        const [bidId, askId] = [timestamp.add(new BN(1)), timestamp]

        // ^ When using Time in Force orders, it's important to use *cluster time*
        // as it might drift from actual UNIX time every once and then, effectively
        // being different to what you'd get using Date.now().

        if (recentBlockTime === null) {
            console.log('Failed to fetch block time')

            return
        }

        const expiryTimestamp = new BN(recentBlockTime + 120)

        tx.add(
            makeCancelAllPerpOrdersInstruction(
                mangoGroupConfig.mangoProgramId,
                mangoGroupConfig.publicKey,
                mangoAccount.publicKey,
                payer.publicKey,
                perpMarket.publicKey,
                perpMarket.bids,
                perpMarket.asks,
                new BN(4)
            ),
            makePlacePerpOrder2Instruction(
                mangoGroupConfig.mangoProgramId,
                mangoGroupConfig.publicKey,
                mangoAccount.publicKey,
                payer.publicKey,
                mangoGroup.mangoCache,
                perpMarket.publicKey,
                perpMarket.bids,
                perpMarket.asks,
                perpMarket.eventQueue,
                mangoAccount.getOpenOrdersKeysInBasket(),
                new BN(bidPrice),
                new BN(bidSize),
                I64_MAX_BN,
                bidId,
                'buy',
                new BN(255),
                'postOnlySlide',
                false,
                undefined,
                expiryTimestamp
            ),
            makePlacePerpOrder2Instruction(
                mangoGroupConfig.mangoProgramId,
                mangoGroupConfig.publicKey,
                mangoAccount.publicKey,
                payer.publicKey,
                mangoGroup.mangoCache,
                perpMarket.publicKey,
                perpMarket.bids,
                perpMarket.asks,
                perpMarket.eventQueue,
                mangoAccount.getOpenOrdersKeysInBasket(),
                new BN(askPrice),
                new BN(askSize),
                I64_MAX_BN,
                askId,
                'sell',
                new BN(255),
                'postOnlySlide',
                false,
                undefined,
                expiryTimestamp
            ),
            riskChecker.makeCheckRiskInstruction(perpMarketConfig, perpMarket)
        )

        tx.sign(payer)

        try {
            const response = await mangoClient.sendSignedTransaction({
                signedTransaction: tx,
                signedAtBlock: recentBlockHash,
            })

            console.log('quote::response', response)
        } catch (error) {
            console.log('quote::error', error);
        }
    }

    console.log('First quoting in ' + (performance.now() / 1e3).toFixed(2) + 's!')

    quote()

    setInterval(quote, 1500)
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


main()

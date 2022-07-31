import {Connection, Keypair, PublicKey, Transaction} from "@solana/web3.js"
import {
    Config,
    getSpotMarketByBaseSymbol,
    getTokenBySymbol, makePlaceSpotOrder2Instruction,
    MangoAccount,
    MangoClient,
    MangoGroup,
    nativeToUi, Payer, QUOTE_INDEX, ZERO_BN
} from "../src";
import fs from "fs";
import os from "os";
import {getFeeRates, getFeeTier, Market} from "@project-serum/serum";
import BN from "bn.js";
import {range, zip} from "lodash";

async function main() {
    const {
        KEYPAIR,
        MANGO_GROUP,
        MANGO_ACCOUNT,
        TOKEN,
        SIDE,
        SIZE
    } = process.env

    const config = Config.ids()

    const mangoGroupConfig = config.getGroupWithName(MANGO_GROUP || 'mainnet.1')

    if (!mangoGroupConfig) {
        console.log(`Couldn't find group by name ${MANGO_GROUP}`)

        return
    }

    if (!SIDE) {
        console.log('Missing SIDE env param, can be either `buy` or `sell`')

        return
    }

    if (SIDE !== 'buy' && SIDE !== 'sell') {
        console.log('SIDE must be either `buy` or `sell`')

        return
    }

    if (!TOKEN) {
        console.log('Enter a token to buy')

        return
    }

    if (!SIZE) {
        console.log('Missing SIZE env param, must be a positive number')

        return
    }

    const connection = new Connection(Config.ids().cluster_urls[mangoGroupConfig.cluster], 'processed')

    const mangoClient = new MangoClient(connection, mangoGroupConfig.mangoProgramId)

    const mangoGroup = await mangoClient.getMangoGroup(mangoGroupConfig.publicKey)

    const [mangoCache, rootBanks] = await Promise.all([
        mangoGroup.loadCache(connection),
        mangoGroup.loadRootBanks(connection)
    ])

    const payer = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse( fs.readFileSync( KEYPAIR || os.homedir() + './.config/solana.id.json', 'utf-8')))
    )

    const mangoAccount = await mangoClient.getMangoAccount(new PublicKey(MANGO_ACCOUNT!), mangoGroup.dexProgramId)

    const spotMarketConfig = getSpotMarketByBaseSymbol(mangoGroupConfig, TOKEN)

    if (!spotMarketConfig) {
        console.log(`No ${TOKEN} token found`)

        return
    }

    const spotMarket = await Market.load(
        connection,
        spotMarketConfig.publicKey,
        undefined,
        mangoGroupConfig.serumProgramId
    )

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey)

    const token = getTokenBySymbol(mangoGroupConfig, spotMarketConfig.baseSymbol)

    const tokenPrice = mangoGroup.cachePriceToUi(
        mangoCache.getPrice(mangoGroup.getTokenIndex(token.mintKey)), mangoGroup.getTokenIndex(token.mintKey)
    )

    const slippageTolerance = 0.5

    const spread = tokenPrice * slippageTolerance

    const bidPrice = tokenPrice + spread

    const askPrice = tokenPrice - spread

    const price = {
        'buy': bidPrice,
        'sell': askPrice
    }[SIDE]

    const latestBlockhash = await connection.getLatestBlockhash('finalized')

    const tx = new Transaction({
        recentBlockhash: latestBlockhash.blockhash,
        feePayer: payer.publicKey
    })

    const instructions = await Promise.all([
        // @ts-ignore
        createPlaceSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, SIDE, price, SIZE, 'limit', undefined, true),
        // @ts-ignore
        createPlaceSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, SIDE, price, SIZE, 'limit', undefined, true),
        // @ts-ignore
        createPlaceSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, SIDE, price, SIZE, 'limit', undefined, true),
        // @ts-ignore
        createPlaceSpotOrder2Instruction(mangoClient, mangoGroup, mangoAccount, spotMarket, payer, SIDE, price, SIZE, 'limit', undefined, true),
    ])

    // @ts-ignore
    tx.add(...instructions)

    tx.sign(payer)

    console.log()

    try {
        console.log(`Placing ${SIDE} market order for ${SIZE} ${TOKEN} (Oracle: ${tokenPrice}, Quote: ${price})`)

        const resp = await mangoClient.sendSignedTransaction({
            signedTransaction: tx,
            signedAtBlock: latestBlockhash,
        });

        console.log('order::response::', resp);
    } catch (error) {
        console.log('order::error::', error);
    }
}

async function createPlaceSpotOrder2Instruction(
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
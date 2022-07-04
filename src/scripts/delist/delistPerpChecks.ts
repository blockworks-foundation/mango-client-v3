import { Connection } from "@solana/web3.js";
import { IDS, MangoClient, MarketMode, ZERO_BN, ZERO_I80F48 } from "../..";
import { Cluster, Config } from "../../config";

const config = new Config(IDS);

const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'devnet.2';
const marketIndex = process.env.MARKET_INDEX ? parseInt(process.env.MARKET_INDEX) : 10;
const groupIds = config.getGroup(cluster, groupName)!;
const marketInfo = groupIds.perpMarkets.find((m) => m.marketIndex == marketIndex)!;

async function checkPerpMarket() {
    const connection = new Connection(config.cluster_urls[cluster]);
    const client = new MangoClient(connection, groupIds.mangoProgramId);
    const mangoGroup = await client.getMangoGroup(groupIds.publicKey);
    const cache = await mangoGroup.loadCache(connection);
    const marketCache = cache.perpMarketCache[marketIndex];
    const market = await mangoGroup.loadPerpMarket(connection, marketIndex, marketInfo.baseDecimals, marketInfo.quoteDecimals);
    const accounts = await client.getAllMangoAccounts(mangoGroup, undefined, false);
    let sumQuote = ZERO_I80F48;
    let sumBase = ZERO_BN;
    let sumMngo = ZERO_BN;

    for (const account of accounts) {
        const perpAccount = account.perpAccounts[marketIndex];
        sumQuote = sumQuote.add(perpAccount.getQuotePosition(marketCache));
        sumBase = sumBase.add(perpAccount.basePosition);
        // if (!perpAccount.getQuotePosition(marketCache).isZero()) {
        //     console.log('Account', account.publicKey.toBase58(), 'had quote position', perpAccount.getQuotePosition(marketCache).toNumber());
        // }
        // if (!perpAccount.basePosition.isZero()) {
        //     console.log('Account', account.publicKey.toBase58(), 'had base position', perpAccount.basePosition.toNumber());
        // }
        sumMngo = sumMngo.add(perpAccount.mngoAccrued);
    }

    console.log(`Market Mode: ${MarketMode[mangoGroup.tokens[marketIndex].perpMarketMode]}`)
    console.log(`Open interest is 0 ${market.openInterest.isZero() ? '✅' : `❎ - ${market.openInterest}`}`);
    console.log(`Fees accrued is 0 ${market.feesAccrued.isZero() ? '✅' : `❎ - ${market.feesAccrued.toNumber()}`}`);
    console.log(`Sum of quote positions is 0 ${sumQuote.isZero() ? '✅' : `❎ - ${sumQuote}`}`);
    console.log(`Sum of base positions is 0 ${sumBase.isZero() ? '✅' : `❎ - ${sumBase}`}`);
    console.log(`MNGO accrued is 0 ${sumMngo.isZero() ? '✅' : `❎ - ${sumMngo}`}`);
    
}

checkPerpMarket();
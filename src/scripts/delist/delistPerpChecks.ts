import { Connection } from "@solana/web3.js";
import { IDS, MangoClient, MarketMode, nativeToUi, ZERO_BN, ZERO_I80F48 } from "../..";
import { Cluster, Config, getPerpMarketConfig } from "../../config";

const config = new Config(IDS);

const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const groupName = process.env.GROUP || 'mainnet.1';
const symbol = process.env.MARKET || 'LUNA';
const groupIds = config.getGroup(cluster, groupName)!;
const marketConfig = getPerpMarketConfig(groupIds, (x) => x.name.includes(symbol))!;
const marketIndex = marketConfig.marketIndex;

async function checkPerpMarket() {
    const connection = new Connection(config.cluster_urls[cluster]);
    const client = new MangoClient(connection, groupIds.mangoProgramId);
    const mangoGroup = await client.getMangoGroup(groupIds.publicKey);
    const cache = await mangoGroup.loadCache(connection);
    const marketCache = cache.perpMarketCache[marketIndex];
    const market = await mangoGroup.loadPerpMarket(connection, marketIndex, marketConfig.baseDecimals, marketConfig.quoteDecimals);
    const accounts = await client.getAllMangoAccounts(mangoGroup, undefined, false);
    let sumQuote = ZERO_I80F48;
    let sumBase = ZERO_BN;
    let sumMngo = ZERO_BN;
    let accountsWithMngo = 0;

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
        if (!perpAccount.mngoAccrued.isZero()) {
            accountsWithMngo++;
            console.log('Account', account.publicKey.toBase58(), 'had base position', perpAccount.basePosition.toNumber());
        }
        sumMngo = sumMngo.add(perpAccount.mngoAccrued);
    }

    //console.log(accountsWithMngo)
    console.log(`Market Mode: ${MarketMode[mangoGroup.tokens[marketIndex].perpMarketMode]}`)
    console.log(`Open interest is 0 ${market.openInterest.isZero() ? '✅' : `❎ - ${market.openInterest}`}`);
    console.log(`Fees accrued is 0 ${market.feesAccrued.isZero() ? '✅' : `❎ - ${market.feesAccrued.toNumber()}`}`);
    console.log(`Sum of quote positions is 0 ${sumQuote.isZero() ? '✅' : `❎ - ${sumQuote}`}`);
    console.log(`Sum of base positions is 0 ${sumBase.isZero() ? '✅' : `❎ - ${sumBase}`}`);
    console.log(`MNGO accrued is 0 ${sumMngo.isZero() ? '✅' : `❎ - ${nativeToUi(sumMngo.toNumber(), 6)}`}`);
    
}

checkPerpMarket();
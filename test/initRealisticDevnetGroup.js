/**
 * How to use:
 * 1.) Update the mango group name on line 7
 * 2.) Run yarn launch-realistic-group
 * 3.) Update the mango group name in keeper.ts crank.ts and in the UI in useMangoStore.ts
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _this = this;
var newGroupName = 'localnet.1';
var mangoProgramId = '95vVcA2MzfMGfnH7vUA32VUau3Z9uQ9DCuA2F6gnYGT5';
var serumProgramId = 'DouSNP811YocCyMf3dnJhkrZR44vQQaRQRQLW6iFnXze';
var feesVault = '54PcMYTAZd8uRaYyb3Cwgctcfc1LchGMaqVrmxgr3yVs'; // devnet vault owned by daffy
var FIXED_IDS = [
    {
        symbol: 'MNGO',
        decimals: 6,
        baseLot: 1000000,
        quoteLot: 100,
        initLeverage: 1.25,
        maintLeverage: 2.5,
        liquidationFee: 0.2,
        oracleProvider: 'switchboard',
        mint: 'Bb9bsTQa1bGEtQ5KagGkvSHyuLqDWumFUcRqFusFNJWC'
    },
    {
        symbol: 'USDC',
        decimals: 6,
        mint: '8FRFC6MoGGkMFQwngccyu69VnYbzykGeez7ignHVAFSN'
    },
    {
        symbol: 'BTC',
        decimals: 6,
        baseLot: 100,
        quoteLot: 10,
        oracleProvider: 'pyth',
        mint: '3UNBZ6o52WTWwjac2kPUb4FyodhU1vFkRJheu1Sh2TvU'
    },
    {
        symbol: 'ETH',
        decimals: 6,
        baseLot: 1000,
        quoteLot: 10,
        oracleProvider: 'pyth',
        mint: 'Cu84KB3tDL6SbFgToHMLYVDJJXdJjenNzSKikeAvzmkA'
    },
    {
        symbol: 'SOL',
        decimals: 9,
        baseLot: 100000000,
        quoteLot: 100,
        oracleProvider: 'pyth',
        mint: 'So11111111111111111111111111111111111111112'
    },
    {
        symbol: 'SRM',
        decimals: 6,
        baseLot: 100000,
        quoteLot: 100,
        oracleProvider: 'pyth',
        mint: 'AvtB6w9xboLwA145E221vhof5TddhqsChYcx7Fy3xVMH'
    },
    {
        symbol: 'RAY',
        decimals: 6,
        baseLot: 100000,
        quoteLot: 100,
        price: 8,
        mint: '3YFQ7UYJ7sNGpXTKBxM3bYLVxKpzVudXAe4gLExh5b3n',
        initLeverage: 3,
        maintLeverage: 6,
        liquidationFee: 0.0833
    },
    {
        symbol: 'USDT',
        decimals: 6,
        baseLot: 1000000,
        quoteLot: 100,
        oracleProvider: 'pyth',
        mint: 'DAwBSXe6w9g37wdE2tCrFbho3QHKZi4PjuBytQCULap2',
        initLeverage: 10,
        maintLeverage: 20,
        liquidationFee: 0.025
    },
];
var initNewGroup = function () { return __awaiter(_this, void 0, void 0, function () {
    var quoteMint, i, fids;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                // const connection: Connection = Test.createDevnetConnection();
                // const mints = IDS.filter((id) => id.symbol !== 'USDC').map((id) => id.mint);
                console.log('starting');
                quoteMint = (_a = FIXED_IDS.find(function (id) { return id.symbol === 'USDC'; })) === null || _a === void 0 ? void 0 : _a.mint;
                return [4 /*yield*/, execCommand("yarn cli init-group ".concat(newGroupName, " ").concat(mangoProgramId, " ").concat(serumProgramId, " ").concat(quoteMint, " ").concat(feesVault))];
            case 1:
                _b.sent();
                console.log("new group initialized");
                i = 0;
                _b.label = 2;
            case 2:
                if (!(i < FIXED_IDS.length)) return [3 /*break*/, 14];
                fids = FIXED_IDS[i];
                if (fids.symbol === 'USDC') {
                    return [3 /*break*/, 13];
                }
                if (!!fids.mint) return [3 /*break*/, 4];
                console.log("adding ".concat(fids.symbol, " mint"));
                return [4 /*yield*/, execCommand("")];
            case 3:
                _b.sent();
                _b.label = 4;
            case 4:
                console.log("adding ".concat(fids.symbol, " oracle"));
                if (!fids.price) return [3 /*break*/, 7];
                return [4 /*yield*/, execCommand("yarn cli add-oracle ".concat(newGroupName, " ").concat(fids.symbol))];
            case 5:
                _b.sent();
                return [4 /*yield*/, execCommand("yarn cli set-oracle ".concat(newGroupName, " ").concat(fids.symbol, " ").concat(fids.price))];
            case 6:
                _b.sent();
                return [3 /*break*/, 9];
            case 7: return [4 /*yield*/, execCommand("yarn cli add-oracle ".concat(newGroupName, " ").concat(fids.symbol, " --provider ").concat(fids.oracleProvider))];
            case 8:
                _b.sent();
                _b.label = 9;
            case 9:
                console.log("listing and adding ".concat(fids.symbol, " spot market"));
                return [4 /*yield*/, execCommand("yarn cli add-spot-market ".concat(newGroupName, " ").concat(fids.symbol, " ").concat(fids.mint, " --base_lot_size ").concat(fids.baseLot, " --quote_lot_size ").concat(fids.quoteLot, " --init_leverage ").concat(fids.initLeverage || 5, " --maint_leverage ").concat(fids.maintLeverage || 10, " --liquidation_fee ").concat(fids.liquidationFee || 0.05))];
            case 10:
                _b.sent();
                if (!(fids.symbol === 'BTC')) return [3 /*break*/, 12];
                console.log("adding ".concat(fids.symbol, " perp market"));
                return [4 /*yield*/, execCommand("yarn cli add-perp-market ".concat(newGroupName, " ").concat(fids.symbol, " --init_leverage ").concat(2 * (fids.initLeverage || 5), " --maint_leverage ").concat(2 * (fids.maintLeverage || 10), " --liquidation_fee ").concat((fids.liquidationFee || 0.05) / 2, " --base_lot_size ").concat(fids.baseLot, " --quote_lot_size ").concat(fids.quoteLot))];
            case 11:
                _b.sent();
                _b.label = 12;
            case 12:
                console.log('---');
                _b.label = 13;
            case 13:
                i++;
                return [3 /*break*/, 2];
            case 14:
                console.log('Succcessfully created new mango group.');
                return [2 /*return*/];
        }
    });
}); };
function execCommand(cmd) {
    var exec = require('child_process').exec;
    return new Promise(function (resolve, _reject) {
        exec(cmd, function (error, stdout, stderr) {
            if (error) {
                console.warn(error);
            }
            resolve(stdout ? stdout : stderr);
        });
    });
}
initNewGroup();

/**
 * How to use:
 * 1.) Update the mango group name on line 7
 * 2.) Run yarn launch-realistic-group
 * 3.) Update the mango group name in keeper.ts crank.ts and in the UI in useMangoStore.ts
 */

const newGroupName = 'devnet.2';
const mangoProgramId = '4skJ85cdxQAFVKbcGgfun8iZPL7BadVYXG3kGEGkufqA';
const serumProgramId = 'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY';
const feesVault = '54PcMYTAZd8uRaYyb3Cwgctcfc1LchGMaqVrmxgr3yVs'; // devnet vault owned by daffy

const FIXED_IDS: any[] = [
  {
    symbol: 'MNGO',
    decimals: 6,
    baseLot: 1000000,
    quoteLot: 100,
    initLeverage: 1.25,
    maintLeverage: 2.5,
    liquidationFee: 0.2,
    oracleProvider: 'switchboard',
    mint: 'Bb9bsTQa1bGEtQ5KagGkvSHyuLqDWumFUcRqFusFNJWC',
  },
  {
    symbol: 'USDC',
    decimals: 6,
    mint: '8FRFC6MoGGkMFQwngccyu69VnYbzykGeez7ignHVAFSN',
  },
  {
    symbol: 'BTC',
    decimals: 6,
    baseLot: 100,
    quoteLot: 10,
    oracleProvider: 'pyth',
    mint: '3UNBZ6o52WTWwjac2kPUb4FyodhU1vFkRJheu1Sh2TvU',
  },
  {
    symbol: 'ETH',
    decimals: 6,
    baseLot: 1000,
    quoteLot: 10,
    oracleProvider: 'pyth',
    mint: 'Cu84KB3tDL6SbFgToHMLYVDJJXdJjenNzSKikeAvzmkA',
  },
  {
    symbol: 'SOL',
    decimals: 9,
    baseLot: 100000000,
    quoteLot: 100,
    oracleProvider: 'pyth',
    mint: 'So11111111111111111111111111111111111111112',
  },
  {
    symbol: 'SRM',
    decimals: 6,
    baseLot: 100000,
    quoteLot: 100,
    oracleProvider: 'pyth',
    mint: 'AvtB6w9xboLwA145E221vhof5TddhqsChYcx7Fy3xVMH',
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
    liquidationFee: 0.0833,
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
    liquidationFee: 0.025,
  },
];

const initNewGroup = async () => {
  // const connection: Connection = Test.createDevnetConnection();
  // const mints = IDS.filter((id) => id.symbol !== 'USDC').map((id) => id.mint);
  console.log('starting');
  const quoteMint = FIXED_IDS.find((id) => id.symbol === 'USDC')
    ?.mint as string;

  await execCommand(
    `yarn cli init-group ${newGroupName} ${mangoProgramId} ${serumProgramId} ${quoteMint} ${feesVault}`,
  );
  console.log(`new group initialized`);

  for (let i = 0; i < FIXED_IDS.length; i++) {
    const fids = FIXED_IDS[i];
    if (fids.symbol === 'USDC') {
      continue;
    }

    if (!fids.mint) {
      console.log(`adding ${fids.symbol} mint`);
      await execCommand(
        ``, // TODO: Create a function that creates the mint
      );
    }

    console.log(`adding ${fids.symbol} oracle`);
    if (fids.price) {
      await execCommand(`yarn cli add-oracle ${newGroupName} ${fids.symbol}`);
      await execCommand(
        `yarn cli set-oracle ${newGroupName} ${fids.symbol} ${fids.price}`,
      );
    } else {
      await execCommand(
        `yarn cli add-oracle ${newGroupName} ${fids.symbol} --provider ${fids.oracleProvider}`,
      );
    }

    console.log(`listing and adding ${fids.symbol} spot market`);
    await execCommand(
      `yarn cli add-spot-market ${newGroupName} ${fids.symbol} ${
        fids.mint
      } --base_lot_size ${fids.baseLot} --quote_lot_size ${
        fids.quoteLot
      } --init_leverage ${fids.initLeverage || 5} --maint_leverage ${
        fids.maintLeverage || 10
      } --liquidation_fee ${fids.liquidationFee || 0.05}`,
    );

    if (fids.symbol === 'BTC') {
      console.log(`adding ${fids.symbol} perp market`);
      await execCommand(
        `yarn cli add-perp-market ${newGroupName} ${
          fids.symbol
        } --init_leverage ${2 * (fids.initLeverage || 5)} --maint_leverage ${
          2 * (fids.maintLeverage || 10)
        } --liquidation_fee ${
          (fids.liquidationFee || 0.05) / 2
        } --base_lot_size ${fids.baseLot} --quote_lot_size ${fids.quoteLot}`,
      );
    }
    console.log('---');
  }
  console.log('Succcessfully created new mango group.');
};

function execCommand(cmd) {
  const exec = require('child_process').exec;
  return new Promise((resolve, _reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.warn(error);
      }
      resolve(stdout ? stdout : stderr);
    });
  });
}

initNewGroup();

/**
 * How to use:
 * 1.) Update the mango group name on line 6
 * 2.) Run yarn launch-realistic-group
 * 3.) Update the mango group name in keeper.ts crank.ts and in the UI in useMangoStore.ts
 */
const newGroupName = 'devnet.0';
const mangoProgramId = '5fP7Z7a87ZEVsKr2tQPApdtq83GcTW4kz919R6ou5h5E';
const serumProgramId = 'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY';

const FIXED_IDS: any[] = [
  {
    symbol: 'MNGO',
    decimals: 6,
    baseLot: 10000000,
    quoteLot: 100,
    price: 0.1,
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
    mint: '3UNBZ6o52WTWwjac2kPUb4FyodhU1vFkRJheu1Sh2TvU',
  },
  {
    symbol: 'ETH',
    decimals: 6,
    baseLot: 1000,
    quoteLot: 10,
    mint: 'Cu84KB3tDL6SbFgToHMLYVDJJXdJjenNzSKikeAvzmkA',
  },
  {
    symbol: 'SOL',
    decimals: 9,
    baseLot: 100000000,
    quoteLot: 100,
    mint: 'So11111111111111111111111111111111111111112',
  },
  {
    symbol: 'SRM',
    decimals: 6,
    baseLot: 100000,
    quoteLot: 100,
    mint: 'AvtB6w9xboLwA145E221vhof5TddhqsChYcx7Fy3xVMH',
  },
  {
    symbol: 'RAY',
    decimals: 6,
    baseLot: 100000,
    quoteLot: 100,
    price: 2,
    mint: '3YFQ7UYJ7sNGpXTKBxM3bYLVxKpzVudXAe4gLExh5b3n',
  },
  {
    symbol: 'DOGE',
    decimals: 6,
    baseLot: 200000000,
    quoteLot: 100,
    mint: '6yr1xJP6Nfu8Bxp4L8WJQrtLqBGZrQm5n41PFm4ZmEyk',
  },
  {
    symbol: 'SUSHI',
    decimals: 6,
    baseLot: 10000,
    quoteLot: 10,
    price: 10,
    mint: 'Edi5KNs2LnonULNmoTQqSymJ7VuMC9amTjLN5RJ1YMcq',
  },
  {
    symbol: 'FTT',
    decimals: 6,
    baseLot: 10000,
    quoteLot: 10,
    price: 30,
    mint: 'Fxh4bpZnRCnpg2vcH11ttmSTDSEeC5qWbPRZNZWnRnqY',
  },
  {
    symbol: 'USDT',
    decimals: 6,
    baseLot: 1000000,
    quoteLot: 100,
    mint: 'DAwBSXe6w9g37wdE2tCrFbho3QHKZi4PjuBytQCULap2',
  },
]

const initNewGroup = async () => {
  // const connection: Connection = Test.createDevnetConnection();
  // const mints = IDS.filter((id) => id.symbol !== 'USDC').map((id) => id.mint);
  console.log('starting');
  const quoteMint = FIXED_IDS.find((id) => id.symbol === 'USDC')
    ?.mint as string;
  await execCommand(
    `yarn cli init-group ${newGroupName} ${mangoProgramId} ${serumProgramId} ${quoteMint}`,
  );
  console.log(`new group initialized`);

  for (let i = 0; i < FIXED_IDS.length; i++) {
    if (FIXED_IDS[i].symbol === 'USDC') {
      continue;
    }

    if (!FIXED_IDS[i].mint) {
      console.log(`adding ${FIXED_IDS[i].symbol} mint`);
      await execCommand(
        ``, // TODO: Create a function that creates the mint
      );
    }

    console.log(`adding ${FIXED_IDS[i].symbol} oracle`);
    if (FIXED_IDS[i].price) {
      await execCommand(
        `yarn cli add-oracle ${newGroupName} ${FIXED_IDS[i].symbol}`,
      );
      await execCommand(
        `yarn cli set-oracle ${newGroupName} ${FIXED_IDS[i].symbol} ${FIXED_IDS[i].price}`,
      );
    } else {
      await execCommand(
        `yarn cli add-oracle ${newGroupName} ${FIXED_IDS[i].symbol} --provider pyth`,
      );
    }


    console.log(`listing and adding ${FIXED_IDS[i].symbol} spot market`);
    await execCommand(
      `yarn cli add-spot-market ${newGroupName} ${FIXED_IDS[i].symbol} ${FIXED_IDS[i].mint} --base_lot_size ${FIXED_IDS[i].baseLot} --quote_lot_size ${FIXED_IDS[i].quoteLot}`,
    );

    console.log(`adding ${FIXED_IDS[i].symbol} perp market`);
    await execCommand(
      `yarn cli add-perp-market ${newGroupName} ${FIXED_IDS[i].symbol}`,
    );
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

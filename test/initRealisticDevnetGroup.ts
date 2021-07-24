/**
 * How to use:
 * 1.) Update the mango group name on line 6
 * 2.) Run yarn launch-realistic-group
 * 3.) Update the mango group name in keeper.ts crank.ts and in the UI in useMangoStore.ts
 */
const newGroupName = 'mango_test_v3.9';
const mangoProgramId = '32WeJ46tuY6QEkgydqzHYU5j85UT9m1cPJwFxPjuSVCt';
const serumProgramId = 'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY';

const FIXED_IDS = [
  {
    symbol: 'USDC',
    mint: '8FRFC6MoGGkMFQwngccyu69VnYbzykGeez7ignHVAFSN',
    dexPk: null,
  },
  {
    symbol: 'BTC',
    mint: '3UNBZ6o52WTWwjac2kPUb4FyodhU1vFkRJheu1Sh2TvU',
    dexPk: '9LBavtqDpEoX623j8z4sotHMDbv7PcTXUW3LQQtepKvR',
  },
  {
    symbol: 'ETH',
    mint: 'Cu84KB3tDL6SbFgToHMLYVDJJXdJjenNzSKikeAvzmkA',
    dexPk: '2n81EqJgsTE5PoPX5H8adQ4EaVe5kXnFuxwdCAYfaExH',
  },
  {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    dexPk: 'uaajXobeb1hmTB6StRoa8Yqn6czjtWtFeVfZeJY6YFC',
  },
  {
    symbol: 'SRM',
    mint: 'AvtB6w9xboLwA145E221vhof5TddhqsChYcx7Fy3xVMH',
    dexPk: '23tRuJ3zUvXYQEnTDAcWHPDfmYvrWanpM2sJnmhL53X5',
  },
  {
    symbol: 'DOGE',
    mint: '6yr1xJP6Nfu8Bxp4L8WJQrtLqBGZrQm5n41PFm4ZmEyk',
    dexPk: 'CrMr521AhZE1FQ9dtBQZczd6SKMpthJMTeQ8WGGRooQ3',
  },
  {
    symbol: 'MNGO',
    mint: 'Bb9bsTQa1bGEtQ5KagGkvSHyuLqDWumFUcRqFusFNJWC',
    dexPk: 'Aph31hoXRjhk1QgCmRvs7WAWGdpRoaESMoqzjoFkL5mE',
  },
  {
    symbol: 'RAY',
    mint: '3YFQ7UYJ7sNGpXTKBxM3bYLVxKpzVudXAe4gLExh5b3n',
    dexPk: '3e7V65UdApsyCMLuALCoQwD9pKDCkozSUrsJx4XMJAnD',
  },
  {
    symbol: 'FTT',
    mint: 'Fxh4bpZnRCnpg2vcH11ttmSTDSEeC5qWbPRZNZWnRnqY',
    dexPk: 'CiN2BzCaThxLRDALeMq3GJGR24MQhdBWmHHjitW74oST',
  },
  {
    symbol: 'STEP',
    mint: '62haNTBB4C3gESJyzAvQVAadNxN9zzVt39x5ep5wmaak',
    dexPk: '8P4kZg2c8pAUC6yLv289fR83LJ2wze1ZT247Fw6MhEiC',
  },
  {
    symbol: 'MER',
    mint: '3QAVaXixBUtHwjponbZZgNVSRqB8YiTqY59pGSWDVS7X',
    dexPk: 'D9Rc98dPsmkfi9wv9yQLKXXu86MZut5jWZSYVCRu51ay',
  },
];

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
    console.log(`adding ${FIXED_IDS[i].symbol} oracle`);
    await execCommand(
      `yarn cli add-oracle ${newGroupName} ${FIXED_IDS[i].symbol} --provider pyth`,
    );

    console.log(`adding ${FIXED_IDS[i].symbol} spot market`);
    await execCommand(
      `yarn cli add-spot-market ${newGroupName} ${FIXED_IDS[i].symbol} ${FIXED_IDS[i].dexPk} ${FIXED_IDS[i].mint}`,
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

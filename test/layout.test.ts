import BN from 'bn.js';
import { struct } from 'buffer-layout';
import { expect } from 'chai';
import { i64, MangoAccountLayout, RootBankLayout } from '../src/layout';

describe('layout parsing', async () => {
  it('all accounts have the correct size', () => {
    expect(MangoAccountLayout.span).to.eq(4296);
  });

  /*
  it('it can parse a margin account', async () => {
    const contents = new Buffer(
      readFileSync('./test/acc-failed-to-parse.b64', 'utf-8'),
      'base64',
    );
    console.log(MangoAccountLayout.decode(contents));
  });
  */

  it('correctly parses i64 layouts', () => {
    const layout = struct([i64('test')]);
    const reference = new BN(-1).toTwos(64).toBuffer();
    expect(reference.toString('hex')).to.eq('ffffffffffffffff');
    const decoded = layout.decode(reference);
    expect(decoded.test.toNumber()).to.eq(-1);

    const encoded = new Buffer('0000000000000000', 'hex');
    layout.encode(decoded, encoded, 0);
    expect(encoded.toString('hex')).to.eq(reference.toString('hex'));
  });

  it('correctly parses root bank layouts', () => {
    const accountJson: { [key: string]: any } = require('./testdata/empty/root_bank0.json');
    const data = Buffer.from(accountJson.data[0], 'base64');
    const rootBank = RootBankLayout.decode(data)

    expect(rootBank.metaData.dataType).to.eq(2);
    expect(rootBank.metaData.version).to.eq(0);
    expect(rootBank.metaData.isInitialized).to.eq(1);

    expect(rootBank.optimalUtil.toString(10)).to.eq("0.69999999999999928946");
    expect(rootBank.optimalRate.toString(10)).to.eq("0.05999999999999872102");
    expect(rootBank.maxRate.toString(10)).to.eq("1.5");
    expect(rootBank.numNodeBanks.toString(10)).to.eq("1");
    expect(rootBank.nodeBanks[0].toBase58()).to.eq("J2Lmnc1e4frMnBEJARPoHtfpcohLfN67HdK1inXjTFSM");
    expect(rootBank.depositIndex.toString(10)).to.eq("1000154.42276607355830719825");
    expect(rootBank.borrowIndex.toString(10)).to.eq("1000219.00867863010088498754");
    expect(new Date(rootBank.lastUpdated.toNumber() * 1000).toUTCString()).to.eq("Mon, 04 Oct 2021 14:58:05 GMT");
  });
});

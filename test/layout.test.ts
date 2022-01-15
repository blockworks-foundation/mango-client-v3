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
});

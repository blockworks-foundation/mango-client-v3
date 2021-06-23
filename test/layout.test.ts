import { expect } from 'chai';
import { readFileSync } from 'fs';
import { MangoAccountLayout } from '../src/layout';

describe('layout parsing', async () => {
  it('all accounts have the correct size', () => {
    expect(MangoAccountLayout.span).to.eq(28408);
  });

  it('it can parse a margin account', async () => {
    const contents = new Buffer(
      readFileSync('./test/acc-failed-to-parse.b64', 'utf-8'),
      'base64',
    );
    console.log(MangoAccountLayout.decode(contents));
  });
});

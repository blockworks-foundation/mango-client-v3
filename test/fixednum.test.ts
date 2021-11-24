import { expect } from 'chai';
import { I80F48 } from '../src/fixednum';
import BN from 'bn.js';
import Big from 'big.js';

describe('fixednumTests', async () => {
  describe('creating an I80F48', async () => {
    // NOTE: The max representation Int is 170141183460469231731687303715884105727 <- ((2 ^ 48) / 2) - 1
    // NOTE: The min representation Int is -170141183460469231731687303715884105728 <- ((2 ^ 48) / 2) * (-1)
    it('should create the max representation number', async () => {
      new I80F48(new BN('170141183460469231731687303715884105727'));
    });
    it('should create the min representation number', async () => {
      new I80F48(new BN('-170141183460469231731687303715884105728'));
    });
    it('should create an arbitrary representation number', async () => {
      new I80F48(new BN('170141183460'));
    });
    it('should fail creating a higher representation number than the max number', async () => {
      expect(function () {
        new I80F48(new BN('170141183460469231731687303715884105728'));
      }).to.throw('Number out of range');
    });
    it('should fail creating a lower representation number than the min number', async () => {
      expect(function () {
        new I80F48(new BN('-170141183460469231731687303715884105729'));
      }).to.throw('Number out of range');
    });
  });

  describe('fromNumber', async () => {
    it('should create the max value', async () => {
      expect(I80F48.fromNumber(Number.MAX_SAFE_INTEGER).toNumber()).to.eq(
        Number.MAX_SAFE_INTEGER,
      );
    });
    it('should create the min value', async () => {
      expect(I80F48.fromNumber(Number.MIN_SAFE_INTEGER).toNumber()).to.eq(
        Number.MIN_SAFE_INTEGER,
      );
    });
    it('fractions', async () => {
      expect(I80F48.fromNumber(2.75).toNumber()).to.eq(
        2.75,
      );
      expect(I80F48.fromNumber(-2.75).toNumber()).to.eq(
        -2.75,
      );
      // lowest bit
      expect(I80F48.fromNumber(Math.pow(2, -48)).getData().toNumber()).to.eq(
        1
      );
      expect(I80F48.fromNumber(-Math.pow(2, -48)).getData().toNumber()).to.eq(
        -1
      );
      // two lowest bits
      expect(I80F48.fromNumber(Math.pow(2, -48) + Math.pow(2, -47)).getData().toNumber()).to.eq(
        3
      );
      // rounded down
      expect(I80F48.fromNumber(0.99 * (Math.pow(2, -48) + Math.pow(2, -47))).getData().toNumber()).to.eq(
        2
      );
      expect(I80F48.fromNumber(-0.99 * (Math.pow(2, -48) + Math.pow(2, -47))).getData().toNumber()).to.eq(
        -2
      );
      expect(I80F48.fromNumber(1.01 * (Math.pow(2, -48) + Math.pow(2, -47))).getData().toNumber()).to.eq(
        3
      );
      expect(I80F48.fromNumber(0.99 * Math.pow(2, -48)).getData().toNumber()).to.eq(
        0
      );
    });
  });

  describe('fromI64', async () => {
    it('should create the max value', async () => {
      expect(I80F48.fromI64(new BN(Number.MAX_SAFE_INTEGER)).toNumber()).to.eq(
        Number.MAX_SAFE_INTEGER,
      );
    });
    it('should create the min value', async () => {
      expect(I80F48.fromI64(new BN(Number.MIN_SAFE_INTEGER)).toNumber()).to.eq(
        Number.MIN_SAFE_INTEGER,
      );
    });
  });

  describe('fromString', async () => {
    // NOTE: The max number of I80 = 604462909807314587353087 <- ((2 ^ 80) / 2) - 1
    // NOTE: The max number of I80F48 = 604462909807314587353087.99999999999999644729 <- 604462909807314587353088 - (1 / (2 ^ 48))
    // NOTE: The min number of I80F48 = I80 = -604462909807314587353088 <- (2 ^ 80) / 2
    it('should create the max value', async () => {
      const stepSize = new Big(1).div(new Big(2).pow(48));
      const maxValue = new Big('604462909807314587353088').minus(stepSize);
      expect(
        I80F48.fromString(maxValue.toFixed()).getData().toString().toString(),
      ).to.equal('170141183460469231731687303715884105727');
    });
    it('should create the min value', async () => {
      expect(
        I80F48.fromString('-604462909807314587353088')
          .getData()
          .toString()
          .toString(),
      ).to.equal('-170141183460469231731687303715884105728');
    });
    it('should create arbitrary values', async () => {
      expect(I80F48.fromString('0').getData().toString()).to.equal('0');
      expect(I80F48.fromString('1').getData().toString()).to.equal(
        '281474976710656',
      );
      expect(I80F48.fromString('-1').getData().toString()).to.equal(
        '-281474976710656',
      );
      expect(I80F48.fromString('1.25').getData().toString()).to.equal(
        '351843720888320',
      );
      expect(I80F48.fromString('-1.25').getData().toString()).to.equal(
        '-351843720888320',
      );
    });
    it('should fail creating a (max number + 1)', async () => {
      expect(function () {
        I80F48.fromString('604462909807314587353088');
      }).to.throw('Number out of range');
    });
    it('should fail creating a (min number - 1)', async () => {
      expect(function () {
        I80F48.fromString('-604462909807314587353089');
      }).to.throw('Number out of range');
    });
  });

  describe('toString', async () => {
    it('should output the max value', async () => {
      expect(
        new I80F48(
          new BN('170141183460469231731687303715884105727'),
        ).toString(),
      ).to.equal('604462909807314587353087.99999999999999644729');
    });
    it('should output the min value', async () => {
      expect(
        new I80F48(
          new BN('-170141183460469231731687303715884105728'),
        ).toString(),
      ).to.equal('-604462909807314587353088');
    });
    it('should output the same string used to create itself', async () => {
      const stepSize = new Big(1).div(new Big(2).pow(48));
      const maxValue = new Big('604462909807314587353088').minus(stepSize);
      expect(I80F48.fromString(maxValue.toFixed()).toString()).to.equal(
        maxValue.toFixed(),
      );
      expect(
        I80F48.fromString('-604462909807314587353088').toString(),
      ).to.equal('-604462909807314587353088');
      expect(I80F48.fromString('1').toString()).to.equal('1');
      expect(I80F48.fromString('-1').toString()).to.equal('-1');
      expect(I80F48.fromString('1.25').toString()).to.equal('1.25');
      expect(I80F48.fromString('-1.25').toString()).to.equal('-1.25');
    });
  });

  describe('fromArray', async () => {
    const maxValue = [
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      127,
    ];
    const minValue = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128];
    const zeroValue = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 0
    const oneValue = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 1
    const oneNegValue = [
      0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]; // -1
    const oneFracValue = [0, 0, 0, 0, 0, 64, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 1.25
    const oneFracNegValue = [
      0, 0, 0, 0, 0, 192, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]; // 1.25
    // NOTE: All array values taken from rust I80F48 fixed point type
    it('should create the max value', async () => {
      expect(
        I80F48.fromArray(new Uint8Array(maxValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('170141183460469231731687303715884105727');
    });
    it('should create the min value', async () => {
      expect(
        I80F48.fromArray(new Uint8Array(minValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('-170141183460469231731687303715884105728');
    });
    it('should create arbitrary values', async () => {
      expect(
        I80F48.fromArray(new Uint8Array(zeroValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('0');
      expect(
        I80F48.fromArray(new Uint8Array(oneValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('281474976710656');
      expect(
        I80F48.fromArray(new Uint8Array(oneNegValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('-281474976710656');
      expect(
        I80F48.fromArray(new Uint8Array(oneFracValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('351843720888320');
      expect(
        I80F48.fromArray(new Uint8Array(oneFracNegValue))
          .getData()
          .toString()
          .toString(),
      ).to.equal('-351843720888320');
    });
    it('should enforce the array length rule', async () => {
      expect(function () {
        I80F48.fromArray(new Uint8Array([1]));
      }).to.throw('Uint8Array must be of length 16');
      expect(function () {
        I80F48.fromArray(
          new Uint8Array([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        );
      }).to.throw('Uint8Array must be of length 16');
    });
  });

  describe('toArray', async () => {
    const maxValue = [
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      127,
    ];
    const minValue = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128];
    const zeroValue = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 0
    const oneValue = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 1
    const oneNegValue = [
      0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]; // -1
    const oneFracValue = [0, 0, 0, 0, 0, 64, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 1.25
    const oneFracNegValue = [
      0, 0, 0, 0, 0, 192, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]; // 1.25
    it('should output the max value', async () => {
      new I80F48(new BN('170141183460469231731687303715884105727'))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(maxValue[i]);
        });
    });
    it('should output the min value', async () => {
      new I80F48(new BN('-170141183460469231731687303715884105728'))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(minValue[i]);
        });
    });
    it('should output the same array used to create itself', async () => {
      I80F48.fromArray(new Uint8Array(maxValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(maxValue[i]);
        });
      I80F48.fromArray(new Uint8Array(minValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(minValue[i]);
        });
      I80F48.fromArray(new Uint8Array(zeroValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(zeroValue[i]);
        });
      I80F48.fromArray(new Uint8Array(oneValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(oneValue[i]);
        });
      I80F48.fromArray(new Uint8Array(oneNegValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(oneNegValue[i]);
        });
      I80F48.fromArray(new Uint8Array(oneFracValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(oneFracValue[i]);
        });
      I80F48.fromArray(new Uint8Array(oneFracNegValue))
        .toArray()
        .forEach((x: any, i: any) => {
          expect(x).to.equal(oneFracNegValue[i]);
        });
    });
    it('toString and toArray should output identical values', async () => {
      const stepSize = new Big(1).div(new Big(2).pow(48));
      const maxStringValue = new Big('604462909807314587353088').minus(
        stepSize,
      );
      expect(I80F48.fromArray(new Uint8Array(maxValue)).toString()).to.equal(
        I80F48.fromString(maxStringValue.toFixed()).toString(),
      );
    });
  });

  describe('add', async () => {
    it('604462909807314587353087 + 0.99999999999999644729 should be 604462909807314587353087.99999999999999644729', async () => {
      expect(
        I80F48.fromString('604462909807314587353087')
          .add(I80F48.fromString('0.99999999999999644729'))
          .toString(),
      ).to.equal('604462909807314587353087.99999999999999644729');
    });
    it('0 + 0 should be 0', async () => {
      expect(
        I80F48.fromString('0').add(I80F48.fromString('0')).toString(),
      ).to.equal('0');
    });
    it('1 + 1 should be 2', async () => {
      expect(
        I80F48.fromString('1').add(I80F48.fromString('1')).toString(),
      ).to.equal('2');
    });
    it('1 + (-1) should be 0', async () => {
      expect(
        I80F48.fromString('1').add(I80F48.fromString('-1')).toString(),
      ).to.equal('0');
    });
    it('1 + 1.25 should be 2.25', async () => {
      expect(
        I80F48.fromString('1').add(I80F48.fromString('1.25')).toString(),
      ).to.equal('2.25');
    });
    it('1.25 + 1.25 should be 2.5', async () => {
      expect(
        I80F48.fromString('1.25').add(I80F48.fromString('1.25')).toString(),
      ).to.equal('2.5');
    });
    it('604462909807314587353087 + 1 should throw', async () => {
      expect(function () {
        I80F48.fromString('604462909807314587353087').add(
          I80F48.fromString('1'),
        );
      }).to.throw('Number out of range');
    });
  });

  describe('subtract', async () => {
    it('604462909807314587353087.99999999999999644729 - 0.99999999999999644729 should be 604462909807314587353087', async () => {
      expect(
        I80F48.fromString('604462909807314587353087.99999999999999644729')
          .sub(I80F48.fromString('0.99999999999999644729'))
          .toString(),
      ).to.equal('604462909807314587353087');
    });
    it('0 - 0 should be 0', async () => {
      expect(
        I80F48.fromString('0').sub(I80F48.fromString('0')).toString(),
      ).to.equal('0');
    });
    it('1 - 1 should be 0', async () => {
      expect(
        I80F48.fromString('1').sub(I80F48.fromString('1')).toString(),
      ).to.equal('0');
    });
    it('1 - (-1) should be 2', async () => {
      expect(
        I80F48.fromString('1').sub(I80F48.fromString('-1')).toString(),
      ).to.equal('2');
    });
    it('1 - 1.25 should be -0.25', async () => {
      expect(
        I80F48.fromString('1').sub(I80F48.fromString('1.25')).toString(),
      ).to.equal('-0.25');
    });
    it('-1.25 - 1.25 should be -2.5', async () => {
      expect(
        I80F48.fromString('-1.25').sub(I80F48.fromString('1.25')).toString(),
      ).to.equal('-2.5');
    });
    it('-604462909807314587353088 - 1 should throw', async () => {
      expect(function () {
        I80F48.fromString('-604462909807314587353088').sub(
          I80F48.fromString('1'),
        );
      }).to.throw('Number out of range');
    });
  });

  describe('multiply', async () => {
    it('1 * 1 should be 1', async () => {
      expect(
        I80F48.fromString('1').mul(I80F48.fromString('1')).toString(),
      ).to.equal('1');
    });
    it('1 * (-1) should be -1', async () => {
      expect(
        I80F48.fromString('1').mul(I80F48.fromString('-1')).toString(),
      ).to.equal('-1');
    });
    it('(-1) * (-1) should be -1', async () => {
      expect(
        I80F48.fromString('-1').mul(I80F48.fromString('-1')).toString(),
      ).to.equal('1');
    });
    it('6 * 7 should be 42', async () => {
      expect(
        I80F48.fromString('6').mul(I80F48.fromString('7')).toString(),
      ).to.equal('42');
    });
    it('6 * (-7) should be -42', async () => {
      expect(
        I80F48.fromString('6').mul(I80F48.fromString('-7')).toString(),
      ).to.equal('-42');
    });
    it('(-6) * (-7) should be 42', async () => {
      expect(
        I80F48.fromString('-6').mul(I80F48.fromString('-7')).toString(),
      ).to.equal('42');
    });
    it('2 * 2.5 should be 5', async () => {
      expect(
        I80F48.fromString('2').mul(I80F48.fromString('2.5')).toString(),
      ).to.equal('5');
    });
    it('2 * (-2.5) should be -5', async () => {
      expect(
        I80F48.fromString('2').mul(I80F48.fromString('-2.5')).toString(),
      ).to.equal('-5');
    });
    it('(-2) * (-2.5) should be 5', async () => {
      expect(
        I80F48.fromString('-2').mul(I80F48.fromString('-2.5')).toString(),
      ).to.equal('5');
    });
    it('2.5 * 3.5 should be 8.75', async () => {
      expect(
        I80F48.fromString('2.5').mul(I80F48.fromString('3.5')).toString(),
      ).to.equal('8.75');
    });
    it('2.5 * (-3.5) should be -8.75', async () => {
      expect(
        I80F48.fromString('2.5').mul(I80F48.fromString('-3.5')).toString(),
      ).to.equal('-8.75');
    });
    it('(-2.5) * (-3.5) should be 8.75', async () => {
      expect(
        I80F48.fromString('-2.5').mul(I80F48.fromString('-3.5')).toString(),
      ).to.equal('8.75');
    });
    it('3.14 * 3.1444 should start with 9.873416', async () => {
      expect(
        I80F48.fromString('3.14').mul(I80F48.fromString('3.1444')).toString(),
      ).to.match(/^9.873416/i);
    });
    it('3.14 * (-3.1444) should start with -9.873416', async () => {
      expect(
        I80F48.fromString('3.14').mul(I80F48.fromString('-3.1444')).toString(),
      ).to.match(/^-9.873416/i);
    });
    it('(-3.14) * (-3.1444) should start with 9.873416', async () => {
      expect(
        I80F48.fromString('-3.14').mul(I80F48.fromString('-3.1444')).toString(),
      ).to.match(/^9.873416/i);
    });
    it('604462909807314587353087 * 2 should throw', async () => {
      expect(function () {
        I80F48.fromString('604462909807314587353087').mul(
          I80F48.fromString('2'),
        );
      }).to.throw('Number out of range');
    });
  });

  describe('divide', async () => {
    it('1 / 1 should be 1', async () => {
      expect(
        I80F48.fromString('1').div(I80F48.fromString('1')).toString(),
      ).to.equal('1');
    });
    it('1 / (-1) should be -1', async () => {
      expect(
        I80F48.fromString('1').div(I80F48.fromString('-1')).toString(),
      ).to.equal('-1');
    });
    it('(-1) / (-1) should be -1', async () => {
      expect(
        I80F48.fromString('-1').div(I80F48.fromString('-1')).toString(),
      ).to.equal('1');
    });
    it('42 / 7 should be 6', async () => {
      expect(
        I80F48.fromString('42').div(I80F48.fromString('7')).toString(),
      ).to.equal('6');
    });
    it('42 / (-7) should be -6', async () => {
      expect(
        I80F48.fromString('42').div(I80F48.fromString('-7')).toString(),
      ).to.equal('-6');
    });
    it('335000022 / 106633819 should start with 3.1415926', async () => {
      expect(
        I80F48.fromString('335000022')
          .div(I80F48.fromString('106633819'))
          .toString(),
      ).to.match(/^3.1415926/i);
    });
    it('335000022 / (-106633819) should start with -3.1415926', async () => {
      expect(
        I80F48.fromString('335000022')
          .div(I80F48.fromString('-106633819'))
          .toString(),
      ).to.match(/^-3.1415926/i);
    });
    it('(-335000022) / (-106633819) should start with 3.1415926', async () => {
      expect(
        I80F48.fromString('-335000022')
          .div(I80F48.fromString('-106633819'))
          .toString(),
      ).to.match(/^3.1415926/i);
    });
  });
});

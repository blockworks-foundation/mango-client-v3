import BN from 'bn.js';
import { FillEvent, LiquidateEvent, OutEvent } from '.';
import { I80F48 } from './fixednum';

export default class PerpEventQueue {
  head!: BN;
  count!: BN;
  seqNum!: BN;
  makerFee!: I80F48;
  takerFee!: I80F48;
  events!: any[];

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }

  getUnconsumedEvents(): {
    fill?: FillEvent;
    out?: OutEvent;
    liquidate?: LiquidateEvent;
  }[] {
    const events: { fill?: FillEvent; out?: OutEvent }[] = [];
    const head = this.head.toNumber();
    for (let i = 0; i < this.count.toNumber(); i++) {
      events.push(this.events[(head + i) % this.events.length]);
    }
    return events;
  }

  // add getConsumedEventsSince()
  // calls eventsSince and removes the last n elements from the array based on this.count

  eventsSince(
    lastSeqNum: BN,
  ): { fill?: FillEvent; out?: OutEvent; liquidate?: LiquidateEvent }[] {
    // TODO doesn't work when lastSeqNum == 0; please fix

    const modulo64Uint = new BN('10000000000000000', 'hex');
    let missedEvents = this.seqNum
      .add(modulo64Uint)
      .sub(lastSeqNum)
      .mod(modulo64Uint);

    /*
    console.log({
      last: lastSeqNum.toString(),
      now: this.seqNum.toString(),
      missed: missedEvents.toString(),
      mod: modulo64Uint.toString(),
    });
    */

    const bufferLength = new BN(this.events.length);
    if (missedEvents.gte(bufferLength)) {
      missedEvents = bufferLength.sub(new BN(1));
    }

    const endIndex = this.head.add(this.count).mod(bufferLength);
    const startIndex = endIndex
      .add(bufferLength)
      .sub(missedEvents)
      .mod(bufferLength);

    /*
    console.log({
      bufLength: bufferLength.toString(),
      missed: missedEvents.toString(),
      head: this.head.toString(),
      count: this.count.toString(),
      end: endIndex.toString(),
      start: startIndex.toString(),
    });
    */

    const results: {
      fill?: FillEvent;
      out?: OutEvent;
      liquidate?: LiquidateEvent;
    }[] = [];
    let index = startIndex;
    while (!index.eq(endIndex)) {
      const event = this.events[index.toNumber()];
      if (event.fill || event.out || event.liquidate) results.push(event);
      index = index.add(new BN(1)).mod(bufferLength);
    }

    return results;
  }
}

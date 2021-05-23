/**
This will probably move to its own repo at some point but easier to keep it here for now
This will be a long running program that will call all the Keeper related instructions on-chain

This will be very similar to the crank in serum dex.

 */
import { sleep } from './utils';


export class Keeper {

  /**
   * Long running program that never exits except on keyboard interrupt
   */
  run() {
    const interval = 5000
    while (true) {
      sleep(interval)


    }
  }
}
import {
  deserializeBorsh,
  LOGGABLE_SCHEMA,
  LoggableFillEvent,
} from './loggable';

function deserializeEvent(b64string: string) {
  const data = Buffer.from(b64string, 'base64');
  const x = deserializeBorsh(LOGGABLE_SCHEMA, LoggableFillEvent, data);
  console.log(x.quantity.toString());
}
deserializeEvent(
  'AAAHAAHsUGEAAAAAPBgBAAAAAAC4kVf55PTy0BmUBbr41IxHf1A9JU8WSrCUWGSI8WTJlExiDwAAAAAAd6QGAAAAAADV4BkkfAEAAAAAAAAAAAAAAAAAAAAAAACtpAYAAAAAAADsUGEAAAAARuIL33wGLo2fQ4HMUgyFM8qr6nKFpEX/UaC1A8l4kMOvnfD//////7X5BgAAAAAAAAAAAAAAAAAdWmQ73///////////////iVv5//////8BAAAAAAAAAA==',
);

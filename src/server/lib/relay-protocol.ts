/**
 * ADR-058: the WebSocket subprotocol a door phone offers the gate relay:
 * our name, then its pass. The pass rides in the handshake (a browser
 * cannot set other headers on a WebSocket), so it is never in a URL.
 * Its own file so the phone's bundle does not pull in the signing code.
 */
export const RELAY_PROTOCOL = 'ea-relay.v1';

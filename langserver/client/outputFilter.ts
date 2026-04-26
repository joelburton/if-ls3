/**
 * Returns true for output-channel messages that are only interesting when
 * debugging the extension itself — suppressed when inform6.verboseOutput
 * is false.
 */
export function isVerboseOnly(msg: string): boolean {
  return (
    msg.startsWith("[activate] server:") ||
    msg.startsWith("[server] exited") ||
    msg.startsWith("[stderr]") ||
    /^\[extension\] (?:TextMate|inform6\.enable)/.test(msg) ||
    /\[indexer\] (?:spawning|OK|stdout:|stderr:)/.test(msg)
  );
}

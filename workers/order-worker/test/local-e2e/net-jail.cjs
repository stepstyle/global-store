// Network jail for the LOCAL e2e run. Loaded into every Node process of the run via
//   NODE_OPTIONS=--require=<this file>
// (the test runner, firebase-tools, wrangler, and anything they spawn with Node).
//
// Any TCP/TLS connection, UDP send or DNS lookup to a non-loopback destination is refused BEFORE a
// packet leaves the process, appended to E2E_JAIL_LOG, and raised as an error (code E2E_EXTERNAL_BLOCKED).
// Native processes (workerd, java) are not covered here — run.mjs watches their sockets separately.
'use strict';

const net = require('node:net');
const dns = require('node:dns');
const dgram = require('node:dgram');
const fs = require('node:fs');

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']);

function isLoopback(host) {
  if (host === undefined || host === null || host === '') return true; // Node's default host is localhost
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK_NAMES.has(h)) return true;
  if (/^127(\.\d{1,3}){3}$/.test(h)) return true;
  if (/^::ffff:127(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

function blocked(kind, host) {
  const msg = `[e2e-jail] BLOCKED ${kind} -> ${host} (pid ${process.pid}, ${process.argv.slice(1, 3).join(' ')})`;
  const log = process.env.E2E_JAIL_LOG;
  if (log) {
    try {
      fs.appendFileSync(log, `${msg}\n`);
    } catch {}
  }
  const e = new Error(msg);
  e.code = 'E2E_EXTERNAL_BLOCKED';
  throw e;
}

/** Destination host of a net.Socket#connect call, or null for IPC (pipe / unix socket). */
function connectTarget(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0]; // Node passes normalized [options, cb] internally
  if (a && typeof a === 'object') {
    if (a.path) return null;
    return { host: a.host ?? a.hostname ?? 'localhost' };
  }
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  }
  if (typeof a === 'string') return null; // connect(path) — IPC
  return { host: 'localhost' };
}

function install() {
  if (global.__E2E_NET_JAIL__) return;
  global.__E2E_NET_JAIL__ = true;

  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function jailedConnect(...args) {
    const t = connectTarget(args);
    if (t && !isLoopback(t.host)) blocked('tcp', t.host);
    return origConnect.apply(this, args);
  };

  // callback APIs: throw synchronously; promise APIs: reject (the attempt is logged either way)
  const wrapLookup = (orig, kind) =>
    function jailedLookup(hostname, ...rest) {
      if (!isLoopback(hostname)) blocked(kind, hostname);
      return orig.call(this, hostname, ...rest);
    };
  const wrapLookupAsync = (orig, kind) =>
    function jailedLookupAsync(hostname, ...rest) {
      try {
        if (!isLoopback(hostname)) blocked(kind, hostname);
      } catch (e) {
        return Promise.reject(e);
      }
      return orig.call(this, hostname, ...rest);
    };
  dns.lookup = wrapLookup(dns.lookup, 'dns.lookup');
  if (dns.promises) dns.promises.lookup = wrapLookupAsync(dns.promises.lookup, 'dns.promises.lookup');
  for (const m of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveSrv', 'resolveTxt', 'reverse']) {
    if (typeof dns[m] === 'function') dns[m] = wrapLookup(dns[m], `dns.${m}`);
    if (dns.promises && typeof dns.promises[m] === 'function') dns.promises[m] = wrapLookupAsync(dns.promises[m], `dns.promises.${m}`);
  }
  for (const [R, wrap] of [[dns.Resolver, wrapLookup], [dns.promises && dns.promises.Resolver, wrapLookupAsync]]) {
    if (!R) continue;
    for (const m of Object.getOwnPropertyNames(R.prototype)) {
      if (/^(resolve|reverse)/.test(m) && typeof R.prototype[m] === 'function') R.prototype[m] = wrap(R.prototype[m], `Resolver.${m}`);
    }
  }

  const origSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function jailedSend(...args) {
    // send(msg, [offset, length,] port, address, cb) — address is the first string after the port
    const addr = args.find((x, i) => i > 0 && typeof x === 'string');
    if (addr !== undefined && !isLoopback(addr)) blocked('udp', addr);
    return origSend.apply(this, args);
  };
  const origUdpConnect = dgram.Socket.prototype.connect;
  if (origUdpConnect) {
    dgram.Socket.prototype.connect = function jailedUdpConnect(port, address, ...rest) {
      if (typeof address === 'string' && !isLoopback(address)) blocked('udp-connect', address);
      return origUdpConnect.call(this, port, address, ...rest);
    };
  }
}

module.exports = { isLoopback, connectTarget, install };
if (process.env.E2E_JAIL !== 'off') install();

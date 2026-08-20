'use strict';

const https = require('https');
const net = require('net');

function createPinnedLookup(record) {
  const address = String(record?.address || '');
  const family = Number(record?.family || net.isIP(address));
  if (!address || (family !== 4 && family !== 6) || net.isIP(address) !== family) {
    throw new Error('A valid resolved address is required.');
  }

  return (_hostname, options, callback) => {
    if (options && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function buildPinnedHttpsOptions(parsed, record, headers = {}) {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  return {
    protocol:'https:',
    hostname,
    port:parsed.port || 443,
    path:`${parsed.pathname}${parsed.search}`,
    method:'GET',
    headers:{ ...headers, Host:parsed.host },
    agent:false,
    lookup:createPinnedLookup(record),
    servername:net.isIP(hostname) ? '' : hostname,
  };
}

function requestPinnedHttps(parsed, record, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let response;
    let settled = false;
    let timer;

    const clearDeadline = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const request = https.request(buildPinnedHttpsOptions(parsed, record, headers), (message) => {
      response = message;
      settled = true;
      const finish = () => clearDeadline();
      message.once('end', finish);
      message.once('close', finish);
      resolve({
        status:Number(message.statusCode || 0),
        ok:Number(message.statusCode || 0) >= 200 && Number(message.statusCode || 0) < 300,
        headers:{
          get(name) {
            const value = message.headers[String(name || '').toLowerCase()];
            if (value == null) return null;
            return Array.isArray(value) ? value.join(', ') : String(value);
          },
        },
        body:message,
        cancel() {
          clearDeadline();
          if (!message.destroyed) message.destroy();
        },
      });
    });

    request.once('error', (error) => {
      clearDeadline();
      if (response && !response.destroyed) response.destroy(error);
      if (!settled) reject(error);
    });

    timer = setTimeout(() => {
      const error = new Error('Image URL request timed out.');
      if (response && !response.destroyed) response.destroy(error);
      request.destroy(error);
    }, timeoutMs);
    timer.unref?.();
    request.end();
  });
}

module.exports = { buildPinnedHttpsOptions, createPinnedLookup, requestPinnedHttps };

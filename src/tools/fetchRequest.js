import promiseTry from "./promiseTry";

const debug = require('debug')('app:fetchRequest');
const http = require('http');
const https = require('https');
const fetch = require('node-fetch');
const AbortController = require('abort-controller');

/**
 * @typedef {Object} FetchRequestOptions
 * @property {string} [method]
 * @property {string} [responseType]
 * @property {Object} [headers]
 * @property {Object} [searchParams]
 * @property {number} [timeout]
 * @property {boolean} [keepAlive]
 * @property {string} [body]
 */

/**
 * @typedef {Object} FetchResponse
 * @property {string} url
 * @property {string} method
 * @property {number} statusCode
 * @property {string} statusMessage
 * @property {*} rawBody
 * @property {*} body
 * @property {Object} headers
 */

/**
 * @param {string} url
 * @param {FetchRequestOptions} [options]
 * @return {Promise<FetchResponse>}
 */
function fetchRequest(url, options) {
  const { responseType, keepAlive, searchParams, timeout = 60 * 1000, ...fetchOptions } = options || {};

  let timeoutId = null;

  return promiseTry(async () => {
    fetchOptions.method = fetchOptions.method || 'GET';

    if (searchParams) {
      const uri = new URL(url);
      uri.search = '?' + new URLSearchParams(searchParams).toString();
      url = uri.toString();
    }

    let agentFn;
    if (keepAlive) {
      agentFn = keepAliveAgentFn;
    }

    let isTimeout = false;
    const controller = new AbortController();
    if (timeout) {
      timeoutId = setTimeout(() => {
        isTimeout = true;
        controller.abort();
      }, timeout);
    }

    const rawResponse = await fetch(url, {
      agent: agentFn,
      ...fetchOptions,
      signal: controller.signal,
    }).catch((err) => {
      if (err.name === 'AbortError' && err.type === 'aborted' && isTimeout) {
        throw new TimeoutError(err);
      }
      else {
        throw new RequestError(err.message, err);
      }
    });

    const fetchResponse = {
      url: rawResponse.url,
      method: fetchOptions.method,
      statusCode: rawResponse.status,
      statusMessage: rawResponse.statusText,
      headers: normalizeHeaders(rawResponse.headers),
      rawBody: undefined,
      body: undefined,
    };

    if (fetchOptions.method !== 'HEAD') {
      try {
        if (responseType === 'buffer') {
          fetchResponse.rawBody = await rawResponse.buffer();
        }
        else {
          fetchResponse.rawBody = await rawResponse.text();
        }
      } catch (err) {
        if (err.name === 'AbortError' && err.type === 'aborted' && isTimeout) {
          throw new TimeoutError(err);
        }
        else {
          throw new ReadError(err, fetchResponse);
        }
      }

      if (responseType === 'json') {
        try {
          fetchResponse.body = JSON.parse(fetchResponse.rawBody);
        }
        catch (err) {
          if (rawResponse.ok) {
            throw err;
          }
        }
      }
      else {
        fetchResponse.body = fetchResponse.rawBody;
      }
    }

    if (!rawResponse.ok) {
      throw new HTTPError(fetchResponse);
    }

    return fetchResponse;
  }).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

class RequestError extends Error {
  constructor(message, error, response) {
    super(message);
    Error.captureStackTrace(this, this.constructor);

    this.name = 'RequestError';
    this.code = error.code;

    if (response) {
      Object.defineProperty(this, 'response', {
        enumerable: false,
        value: response
      });
    }

    if (typeof error.stack !== "undefined") {
      const indexOfMessage = this.stack.indexOf(this.message) + this.message.length;
      const thisStackTrace = this.stack.slice(indexOfMessage).split('\n').reverse();
      const errorStackTrace = error.stack.slice(error.stack.indexOf(error.message) + error.message.length).split('\n').reverse();
      // Remove duplicated traces
      while (errorStackTrace.length !== 0 && errorStackTrace[0] === thisStackTrace[0]) {
        thisStackTrace.shift();
      }
      this.stack = `${this.stack.slice(0, indexOfMessage)}${thisStackTrace.reverse().join('\n')}${errorStackTrace.reverse().join('\n')}`;
    }
  }
}

class HTTPError extends RequestError {
  constructor(response) {
    super(`Response code ${response.statusCode} (${response.statusMessage})`, {}, response);
    this.name = 'HTTPError';
  }
}

class TimeoutError extends RequestError {
  constructor(error) {
    super(error.message, error, undefined);
    this.name = 'TimeoutError';
  }
}

class ReadError extends RequestError {
  constructor(error, response) {
    super(error.message, error, response);
    this.name = 'ReadError';
  }
}


const httpAgent = new http.Agent({
  keepAlive: true
});

const httpsAgent = new https.Agent({
  keepAlive: true
});

function keepAliveAgentFn(_parsedURL) {
  if (_parsedURL.protocol === 'http:') {
    return httpAgent;
  }
  else {
    return httpsAgent;
  }
}

function normalizeHeaders(fetchHeaders) {
  const headers = {};
  const rawHeaders = fetchHeaders.raw();
  Object.entries(rawHeaders).forEach(([key, values]) => {
    const lowKey = key.toLowerCase();
    if (values.length === 1) {
      headers[lowKey] = values[0];
    } else
    if (values.length) {
      headers[lowKey] = values;
    }
  });
  return headers;
}

export default fetchRequest;
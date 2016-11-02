const extend = require('extend');
const Q = require('q');
const request = require('requestretry');

class GHRequestor {
  constructor(options = {}) {
    this.options = this.buildOptions(options);
    this.activity = [];
  }

  buildOptions(options) {
    const headers = extend({}, GHRequestor.defaultOptions.headers, options.headers);
    const result = extend({}, GHRequestor.defaultOptions, options, { headers: headers });
    result.retryStrategy = this.retryStrategy.bind(this);
    result.delayStrategy = this.retryDelayStrategy.bind(this);
    return result;
  }

  static get defaultOptions() {
    return {
      json: true,
      headers: { 'User-Agent': 'ghcrawler' },
      maxAttempts: 5,
      retryDelay: 500,
      forbiddenDelay: 3 * 60 * 1000,
      tokenLowerBound: 500
    };
  }

  // Ensure that the given URL has a per_page query parameter.
  // Either the one it already has or the max 100
  static ensureMaxPerPage(url) {
    if (url.includes('per_page')) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}per_page=100`;
  }

  static parseLinkHeader(header) {
    if (header.length === 0) {
      throw new Error("input must not be of zero length");
    }

    // Split parts by comma
    const parts = header.split(',');
    const links = {};
    // Parse each part into a named link
    for (var i = 0; i < parts.length; i++) {
      const section = parts[i].split(';');
      if (section.length !== 2) {
        throw new Error("section could not be split on ';'");
      }
      const url = section[0].replace(/<(.*)>/, '$1').trim();
      const name = section[1].replace(/rel="(.*)"/, '$1').trim();
      links[name] = url;
    }
    return links;
  }

  // Attempt to get all pages related to the given target URL.  If a callback is supplied
  // it will be called with the first arg being an object with the error and the problematic
  // response (if any).  On success the callback is invoked with null and the accumulated results.
  // In the error case the cal
  getAll(target, callback = null, result = []) {
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else
        deferred.resolve(value);
    });
    target = GHRequestor.ensureMaxPerPage(target);
    const self = this;
    self.get(target, (err, response, body) => {
      // if we get an error or a non-200 response, return an Error object that has the
      // error and response (if any).
      if (err) {
        return realCallback({ error: err });
      }
      if (response && response.status >= 300) {
        return realCallback({ error: new Error('Non-200 response received'), response: response });
      }

      let accumulatedValue = body;
      if (response.headers.link) {
        accumulatedValue = result.concat(body);
        const links = GHRequestor.parseLinkHeader(response.headers.link);
        if (links.next) {
          return self.getAll(links.next, realCallback, accumulatedValue);
        }
      }

      realCallback(null, accumulatedValue);
    });
    return callback ? null : deferred.promise;
  }

  get(target, callback = null) {
    const deferred = Q.defer();
    target = GHRequestor.ensureMaxPerPage(target);
    const self = this;
    const activity = {};
    self.activity.push(activity);
    request.get(target, self.options, (err, response, body) => {
      activity.attempts = response ? response.attempts : null;
      if (err) {
        return callback ? callback(err, response, body) : deferred.reject(err);
      }
      // If we hit the low water mark for requests, proactively sleep until the next ratelimit reset
      // This code is not designed to handle the 403 scenarios.  That is handled by the retry logic.
      const remaining = parseInt(response.headers['x-ratelimit-remaining']) || 0;
      const reset = parseInt(response.headers['x-ratelimit-reset']) || 0;
      if (remaining < self.options.tokenLowerBound) {
        const toSleep = Math.max(reset*1000 - Date.now(), 2000);
        activity.rateLimitDelay = toSleep;
        // if in test mode, don't actually sleep.  Fall through having remembered
        // that we would have slept and how much
        if (self.options.mode !== 'test') {
          return setTimeout(() => {
            return callback ? callback(err, response, body) : deferred.resolve(response);
          }, toSleep);
        }
      }
      callback ? callback(err, response, body) : deferred.resolve(response);
    });
    return callback ? null : deferred.promise;
  }

  retryStrategy(err, response, body) {
    // if we received a 403 then extra ratelimiting has been applied.
    // Wait a few minutes and then try again.  If its a 5** or error then retry.
    // All others, do not retry as it won't help
    if (response && response.status === 403) {
      response._forbiddenDelay = this.options.forbiddenDelay;
      return true;
    }
    if (err || response.status >= 500)
      return true;

    return false;
  }

  retryDelayStrategy(err, response, body) {
    const forbiddenDelay = response ? response._forbiddenDelay : null;
    const activity = this.activity.slice(-1)[0];
    activity.delays = activity.delays || [];
    if (forbiddenDelay) {
      activity.delays.push({ forbidden: forbiddenDelay });
    } else {
      activity.delays.push({ retry: this.options.retryDelay });
    }
    return forbiddenDelay || this.options.retryDelay;
  }
}

module.exports = GHRequestor;
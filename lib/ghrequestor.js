const extend = require('extend');
const Q = require('q');
const request = require('requestretry');


    /**
   * Attempt to get all pages related to the given target URL.  The callback supplied, if any,
   * is called when all pages have been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. The promise will be resolved with the
   * collected bodies on success or rejected with an error object.  The error may have a response property
   * containing the response that caused the failure.
   * @param {string} target URL to fetch and paginate
   * @param {Array} [result] Array into which results are put.
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
 module.exports.getAll = function getAll(target, options = {}, callback = null) {
    const requestor = new GHRequestor(options);
    return requestor.getAll(target, callback).then(result => {
      requestor.result.activity = requestor.activity;
      return requestor.result;
    });
  }

    /**
   * Attempt to get the GitHub resource at the given target URL.  The callback supplied, if any,
   * is called when the resource has been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. The promise will be resolved with the
   * response on success or rejected with an error object. Note that responses with statusCode >=300 are not
   * errors -- the promise will be resolved with such a response.
   * @param {string} target URL to fetch
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
module.exports.get = function get(target, options = {}, callback = null) {
    const requestor = new GHRequestor(options);
    return requestor.get(target, callback);
  }


class GHRequestor {

  constructor(givenOptions) {
    this.result = [];
    const defaultOptions = GHRequestor.defaultOptions;
    const headers = extend({}, defaultOptions.headers, givenOptions.headers);
    this.options = extend({}, defaultOptions, givenOptions, { headers: headers });
    this.options.retryStrategy = GHRequestor.retryStrategy.bind(this);
    this.options.delayStrategy = GHRequestor.retryDelayStrategy.bind(this);
    this.activity = [];
    return this;
  }

  static get defaultOptions() {
    return {
      json: true,
      headers: { 'User-Agent': 'ghrequestor' },
      maxAttempts: 5,
      retryDelay: 500,
      forbiddenDelay: 3 * 60 * 1000,
      tokenLowerBound: 500
    };
  }

  // Ensure that the given URL has a perpage query parameter.
  // Either the one it already has or the max 100
  static ensureMaxPerPage(url) {
    if (url.includes('perpage')) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}perpage=100`;
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



  getAll(target, callback = null) {
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else
        deferred.resolve(value);
    });
    const self = this;
    target = GHRequestor.ensureMaxPerPage(target);
    self.get(target, (err, response, body) => {
      // if we get an error or a non-200 response, return an Error object that has the
      // error and response (if any).
      if (err || response && response.statusCode >= 300) {
        err = err || new Error(response.statusMessage);
        err.response = response;
        err.activity = self.activity;
        return realCallback(err);
      }

      // merge or add the body to the result
      if (Array.isArray(body)) {
        Array.prototype.push.apply(self.result, body);
      } else {
        self.result.push(body);
      }

      if (response.headers.link) {
        // if there is a next page, go for it.
        const links = GHRequestor.parseLinkHeader(response.headers.link);
        if (links.next) {
          return self.getAll(links.next, realCallback);
        }
      }

      realCallback(null, self.result);
    });
    return callback ? null : deferred.promise;
  }



  get(target, callback = null) {
    const deferred = Q.defer();
    target = GHRequestor.ensureMaxPerPage(target);
    const self = this;
    const activity = {};
    this.activity.push(activity);
    request.get(target, this.options, (err, response, body) => {
      if (response) {
        activity.attempts = response.attempts;
        response.activity = self.activity;
      }
      if (err || response && response.statusCode >= 300) {
        if (!err) {
          err = new Error(response.statusMessage);
        }
        err.response = response;
        err.activity = self.activity;
        return callback ? callback(err, response, body) : deferred.reject(err);
      }
      // If we hit the low water mark for requests, proactively sleep until the next ratelimit reset
      // This code is not designed to handle the 403 scenarios.  That is handled by the retry logic.
      const remaining = parseInt(response.headers['x-ratelimit-remaining']) || 0;
      const reset = parseInt(response.headers['x-ratelimit-reset']) || 0;
      if (remaining < self.options.tokenLowerBound) {
        const toSleep = Math.max(reset * 1000 - Date.now(), 2000);
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

  static retryStrategy(err, response, body) {
    // if we received a 403 then extra ratelimiting has been applied.
    // Wait a few minutes and then try again.  If its a 5** or error then retry.
    // All others, do not retry as it won't help
    if (response && response.statusCode === 403) {
      response.forbiddenDelay = this.options.forbiddenDelay;
      return true;
    }
    if (err || response.statusCode >= 500)
      return true;

    return false;
  }

  static retryDelayStrategy(err, response, body) {
    const forbiddenDelay = response ? response.forbiddenDelay : null;
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



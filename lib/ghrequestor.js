const extend = require('extend');
const Q = require('q');
const request = require('requestretry');

  /**
   * Attempt to get the GitHub resource at the given target URL.  The callback supplied, if any,
   * is called when the resource has been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. The promise will be resolved with the
   * response on success or rejected with an error object. Note that responses with statusCode >=300 are not
   * errors -- the promise will be resolved with such a response.
   * @param {string} target URL to fetch
   * @param {object} [options] Options to use through the retry and request process.
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
function get(target, options = {}, callback = null) {
    return new GHRequestor(options)._get(target, callback);
}

module.exports.get = get;

  /**
   * Attempt to get all pages related to the given target URL.  The callback supplied, if any,
   * is called when all pages have been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. The promise will be resolved with the
   * collected bodies on success or rejected with an error object.  The error may have a response property
   * containing the response that caused the failure.
   * @param {string} target URL to fetch and paginate
   * @param {object} [options] Options to use through the retry and request process.
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
function getAll(target, options = {}, callback = null) {
    return new GHRequestor(options).getAll(target, callback);
}

module.exports.getAll = getAll;

module.exports.getInstance = function (options) {
    return new Requestor(options);
}

class Requestor {
    constructor(options = {}) {
        this.defaultOptions = options;
    }
    get(target, options, callback) {
        if (typeof options == 'function') {
            callback = options;
            options = null;
        };
        return get(target, options ? options : this.defaultOptions, callback);
    }
    getAll(target, options, callback) {
        if (typeof options == 'function') {
            callback = options;
            options = null;
        };
        return getAll(target, options ? options : this.defaultOptions, callback);
    }
}


class GHRequestor {
  constructor(givenOptions = {}) {
    const defaultOptions = GHRequestor._defaultOptions;
    const headers = extend({}, defaultOptions.headers, givenOptions.headers);
    this.options = extend({}, defaultOptions, givenOptions, { headers: headers });
    this.options.retryStrategy = GHRequestor._retryStrategy.bind(this);
    this.options.delayStrategy = GHRequestor._retryDelayStrategy.bind(this);
    this._initialize();
    return this;
  }

  _initialize() {
    this.result = [];
    this.activity = [];
  }

  static get _defaultOptions() {
    return {
      json: true,
      headers: { 'User-Agent': 'ghrequestor' },
      maxAttempts: 5,
      retryDelay: 500,
      forbiddenDelay: 3 * 60 * 1000,
      tokenLowerBound: 500
    };
  }

  // Ensure that the given URL has a per_page query parameter.
  // Either the one it already has or the max 100
  static _ensureMaxPerPage(url) {
    if (url.includes('per_page')) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}per_page=100`;
  }

  static _parseLinkHeader(header) {
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
    this._initialize();
    const self = this;
    return this._getAll(target, callback).then(result => {
      self.result.activity = self.activity;
      return self.result;
    });
  }

  _getAll(target, callback = null) {
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else
        deferred.resolve(value);
    });
    const self = this;
    target = GHRequestor._ensureMaxPerPage(target);
    self._get(target, (err, response, body) => {
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
        const links = GHRequestor._parseLinkHeader(response.headers.link);
        if (links.next) {
          return self._getAll(links.next, realCallback);
        }
      }

      realCallback(null, self.result);
    });
    return callback ? null : deferred.promise;
  }


  get(target, callback = null) {
    this._initialize();
    return this._get(target, callback);
  }

  _get(target, callback = null) {
    const deferred = Q.defer();
    target = GHRequestor._ensureMaxPerPage(target);
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

  static _retryStrategy(err, response, body) {
    // if we received a 403 then extra ratelimiting has been applied.
    // Wait a few minutes and then try again.  If its a 5** or error then retry.
    // All others, do not retry as it won't help
    if (response && response.statusCode === 403) {
      response._forbiddenDelay = this.options.forbiddenDelay;
      return true;
    }
    if (err || response.statusCode >= 500)
      return true;

    return false;
  }

  static _retryDelayStrategy(err, response, body) {
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

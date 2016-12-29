// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const extend = require('extend');
const parse = require('parse-link-header');
const Q = require('q');
const qlimit = require('qlimit');
const request = require('requestretry');

class GHRequestor {
  /**
   * Attempt to get the GitHub resource at the given target URL.  The callback supplied, if any,
   * is called when the resource has been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. The promise will be resolved with the
   * response on success or rejected with an error object. Note that responses with statusCode >=300 are not
   * errors -- the promise will be resolved with such a response.
   *
   * Note that the options can include an etags property that is an array of etags to use for the GET requests.
   * Element N-1 of the array will be used for page N of a multi page request.
   *
   * @param {string} target URL to fetch
   * @param {object} [options] Options to use through the retry and request process.
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
  static get(target, options = {}, callback = null) {
    if (typeof options == 'function') {
      callback = options;
      options = null;
    }
    return new RequestorAction(options).get(target, callback);
  }

  /**
   * Attempt to get all pages related to the given target URL.  The callback supplied, if any,
   * is called when all pages have been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. Either way, on success the returned value is the
   * collected elements from all the pages.  The result is truncated at the point of the first non-200
   * responses. In the error case, the error object may have a response property containing the
   * response that caused the failure.
   *
   * @param {string} target URL to fetch and paginate
   * @param {object} [options] Options to use through the retry and request process.
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
  static getAll(target, options = {}, callback = null) {
    return GHRequestor.getAllResponses(target, options, callback).then(GHRequestor.flattenResponses);
  }

  /**
   * Attempt to get all pages related to the given target URL.  The callback supplied, if any,
   * is called when all pages have been retrieved or an irrecoverable problem has been encountered.
   * If a callback is not supplied, a promise is returned. Either way, on success the returned value is the
   * collected responses.  Note that this may be a mixed bag of 200 OK and 304 Not Modified (if etags were
   * supplied). Each response's "body" will contain that page of data. In the error case, the error object
   * may have a response property containing the response that caused the failure.
   *
   * Note that the options can include an etags property that is an array of etags to use for the GET requests.
   * Element N-1 of the array will be used for page N of a multi page request.
   *
   * @param {string} target URL to fetch and paginate
   * @param {object} [options] Options to use through the retry and request process.
   * @param {function} [callback] Function to call on completion of the retrieval.
   * @returns {null|promise} null if a callback is supplied. A promise otherwise.
   */
  static getAllResponses(target, options = {}, callback = null) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    return new RequestorAction(options).getAll(target, callback);
  }

  /**
   * Get a requestor pre-configured with the given options.
   * @param {object} options The set of options with which to configure the result.
   * @returns {requestor} A requestor configured with the given options.
   */
  static defaults(options) {
    const newOptions = GHRequestor.mergeOptions(this.defaultOptions, options);
    return new RequestorTemplate(newOptions);
  }

  /**
   * Helper function used to merge options. Care is taken to merge headers as well as properties.
   * @param {object} defaultOptions The base set of options.
   * @param {object} givenOptions The set of options to overlay on the defaults.
   * @returns {object} The two sets of options merged.
   */
  static mergeOptions(defaultOptions, givenOptions) {
    if (!givenOptions) {
      return defaultOptions;
    } else if (!defaultOptions) {
      return givenOptions;
    }
    const headers = extend({}, defaultOptions.headers, givenOptions.headers);
    return extend({}, defaultOptions, givenOptions, { headers: headers });
  }

  /**
   * Flatten a set of responses (e.g., pages) into one array of values.  If any
   * repsonse is a 304 then ask the given supplier to resolve response to an array of
   * values to be included in the result.  The supplier is given the response and
   * should return a value or a promise.  A supplier may, for example, look in a local
   * cache for the previously fetched response.
   * @param {array} repsonses The GET responses to flatten
   * @param {function} [supplier] A function that will resolve a response to a set of values
   * @returns {array} The flattened set of response bodies
   */
  static flattenResponses(responses, supplier) {
    const chunks = responses.map(qlimit(10)(response => {
      if (response.statusCode === 200) {
        return Q(response.body);
      }
      if (response.statusCode === 304) {
        if (!supplier) {
          return Q.reject(new Error(`304 response encountered but no content supplier found`));
        }
        return Q(supplier(response.url));
      }
      return Q.reject(new Error(`Cannot flatten response with status code: ${response.statusCode}`));
    }));
    return Q.all(chunks).then(resolvedChunks => {
      const result = resolvedChunks.reduce((result, element) => {
        return result.concat(element);
      }, []);
      result.activity = responses.activity;
      return result;
    });
  }
}

module.exports = GHRequestor;

class RequestorTemplate {
  constructor(options = {}) {
    this.defaultOptions = options;
  }

  get(target, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    return GHRequestor.get(target, GHRequestor.mergeOptions(this.defaultOptions, options), callback);
  }

  getAll(target, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    return GHRequestor.getAll(target, GHRequestor.mergeOptions(this.defaultOptions, options), callback);
  }

  getAllResponses(target, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    return GHRequestor.getAllResponses(target, GHRequestor.mergeOptions(this.defaultOptions, options), callback);
  }

  mergeOptions(defaultOptions, givenOptions) {
    return GHRequestor.mergeOptions(defaultOptions, givenOptions);
  }

  defaults(options) {
    const newOptions = GHRequestor.mergeOptions(this.defaultOptions, options);
    return new RequestorTemplate(newOptions);
  }

  flattenResponses(responses, supplier) {
    return GHRequestor.flattenResponses(responses, supplier);
  }
}

class RequestorAction {
  constructor(givenOptions = {}) {
    this.options = GHRequestor.mergeOptions(RequestorAction._defaultOptions, givenOptions);
    this.options.retryStrategy = RequestorAction._retryStrategy.bind(this);
    this.options.delayStrategy = RequestorAction._retryDelayStrategy.bind(this);
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
      delayOnThrottle: true,
      tokenLowerBound: 500,
      logger: null
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

  getAll(target, callback = null) {
    this._initialize();
    const self = this;
    self._log('info',`GetAllStarted`, {target: target});
    return this._getAll(target, callback).then(result => {
      self.result.activity = self.activity;
      return self.result;
    });
  }

  _getAll(target, callback = null) {
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err) {
        deferred.reject(err);
      }
      else
        deferred.resolve(value);
    });
    const self = this;
    self._get(target, (err, response, body) => {
      // if we get an error, stash the repsonse (if any) and activity, and pass the error along.
      if (err) {
        self._log('error',`GetAllError`, {target: target, error: err});
        err.response = response;
        err.activity = self.activity;
        return realCallback(err);
      }

      self.result.push(response);

      // if the response is not great (basically anything other than 200 and 304), bail out
      if (response && (response.statusCode >= 300 && response.statusCode !== 304)) {
        self._log('error',`GetAllResponseFail`, {target: target, statusCode: response.statusCode, message:response.statusMessage });
        return realCallback(null, self.result);
      }

      // if there is a next page, go for it.
      if (response.headers.link) {
        const links = parse(response.headers.link);
        if (links.next) {
          self._log('info', `GetAllResponseNextPage`, {target: links.next.url});
          return self._getAll(links.next.url, realCallback);
        }
      }

      realCallback(null, self.result);
    });
    return callback ? null : deferred.promise;
  }

  get(target, callback = null) {
    this._initialize();
    this._log('info',`GetStarted`, {target: target});
    return this._get(target, callback);
  }

  _get(target, callback = null) {
    const deferred = Q.defer();
    target = RequestorAction._ensureMaxPerPage(target);
    const self = this;
    const activity = {};
    this.activity.push(activity);
    let options = this.options;
    if (this.options.etags) {
      const etag = this.options.etags[this.activity.length - 1];
      if (etag) {
        options = GHRequestor.mergeOptions(this.options, { headers: { 'If-None-Match': etag } });
      }
    }

    const actualRetry = options.retryStrategy;
    options.retryStrategy = RequestorAction._retryStrategyWrapper(target, self._log.bind(self), options.retryStrategy);

    request.get(target, options, (err, response, body) => {
      options.retryStrategy = actualRetry;
      if (response) {
        self._log('debug', `GetResponseReceived`, {target: target, attempts: response.attempts, statusCode: response.statusCode });
        activity.attempts = response.attempts;
        response.activity = self.activity;
      }
      if (err || !response) {
        err = err || new Error(response.statusMessage);
        self._log('error', `GetError`, {target: target, error: err});
        err.response = response;
        err.activity = self.activity;
        return callback ? callback(err, response, body) : deferred.reject(err);
      }
      // Failed here so resolve with the same response
      if (response.statusCode >= 300) {
        self._log('error', `GetFailedResponse`, {target: target, statusCode: response.statusCode, message:response.statusMessage });
        return callback ? callback(err, response, body) : deferred.resolve(response);
      }

      // If we hit the low water mark for requests, proactively sleep until the next ratelimit reset
      // This code is not designed to handle the 403 scenarios.  That is handled by the retry logic.
      const remaining = parseInt(response.headers['x-ratelimit-remaining']) || 0;
      const reset = parseInt(response.headers['x-ratelimit-reset']) || 0;
      if (self.options.delayOnThrottle && remaining < self.options.tokenLowerBound) {
        const toSleep = Math.max(reset * 1000 - Date.now(), 2000);
        activity.rateLimitDelay = toSleep;
        // if in test mode, don't actually sleep.  Fall through having remembered
        // that we would have slept and how much
        if (self.options.mode !== 'test') {
          self._log('info', `GetTokenDelayStarted`, {target: target, toSleep: toSleep, remaining: remaining, reset: reset });
          return setTimeout(() => {
            return callback ? callback(err, response, body) : deferred.resolve(response);
          }, toSleep);
        }
      }
      callback ? callback(err, response, body) : deferred.resolve(response);
    });
    options.retryStrategy = actualRetry;
    return callback ? null : deferred.promise;
  }

  _log(level, message, data) {
    const self = this;
    if (self.options.logger) {
      self.options.logger.log(level, message, data);
    }
  }

  static _retryStrategy(err, response, body) {
    // if we received a 403 then extra ratelimiting has been applied.
    // Wait a few minutes and then try again.  If its a 5** or error then retry.
    // All others, do not retry as it won't help
    if (response && response.statusCode === 403 && this.options.forbiddenDelay) {
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

  static _retryStrategyWrapper(target, log, cb) {
    return function (error, response, body) {
      if (error) {
        log('error', `GetRetryStrategy`, {target: target, error: error})
      } else {
        log('info', `GetRetryStrategy`, { target: target, responseStatus: response.statusCode, responseMessage: response.statusMessage});
      }
      return cb(error, response, body);
    }
  }
}

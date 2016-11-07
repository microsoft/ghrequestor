const GHRequestor = require('./ghrequestor');
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


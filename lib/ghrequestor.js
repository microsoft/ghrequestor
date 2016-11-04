const GHRequestor = require('./requestClient')

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


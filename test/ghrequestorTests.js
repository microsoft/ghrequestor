const assert = require('chai').assert;
const chai = require('chai');
const expect = require('chai').expect;
const extend = require('extend');
const requestor = require('../lib/ghrequestor.js');
const request = require('requestretry');

const urlHost = 'https://test.com';

describe('Request option merging', () => {
  it('should merge and override properties', () => {
    const defaults = {
      retryDelay: 10,
      headers: { authorization: 'foo' }
    };
    const result = requestor.mergeOptions(defaults, {
      retryDelay: 10,
      testProperty: 'test value',
      headers: {
        'User-Agent': 'test agent',
        authorization: 'test auth'
      }
    });
    expect(result.retryDelay).to.equal(10);
    expect(result.testProperty).to.equal('test value');
    expect(result.headers['User-Agent']).to.equal('test agent');
    expect(result.headers.authorization).to.equal('test auth');
  });
});

describe('Response collapsing...', () => {
  it('should work for single response', () => {
    const responses = [createResponse([{ id: 'cool object' }], 200).response];
    requestor.flattenResponses(responses).then(result => {
      expect(result.length).to.equal(1);
      expect(result[0].id).to.equal('cool object');
    });
  });

  it('should work for multiple responses', () => {
    const responses = [
      createResponse([{ id: 'object 1' }, { id: 'object 2' }], 200).response,
      createResponse([{ id: 'object 3' }], 200).response,
      createResponse([], 200).response,
    ];
    requestor.flattenResponses(responses).then(result => {
      expect(result.length).to.equal(3);
      expect(result[0].id).to.equal('object 1');
      expect(result[1].id).to.equal('object 2');
      expect(result[2].id).to.equal('object 3');
    });
  });

  it('should work with a supplier', () => {
    const responses = [
      createResponse([{ id: 'object 1' }, { id: 'object 2' }], 200).response,
      createResponse(null, 304).response,
    ];
    const supplier = response => {
      return [{ id: 'object 3' }, { id: 'object 4' }];
    };
    requestor.flattenResponses(responses, supplier).then(result => {
      expect(result.length).to.equal(4);
      expect(result[0].id).to.equal('object 1');
      expect(result[1].id).to.equal('object 2');
      expect(result[0].id).to.equal('object 3');
      expect(result[1].id).to.equal('object 4');
    });
  });

  it('should fail for bad status codes', () => {
    const responses = [
      createResponse([{ id: 'object 1' }, { id: 'object 2' }], 200).response,
      createResponse(null, 500).response,
    ];
    requestor.flattenResponses(responses).then(
      result => {
        assert.fail();
      },
      err => {
        expect(err.startsWith('Cannot')).to.be.true;
      });
  });
});

describe('Request retry and success', () => {
  it('should be able to get a single page resource', () => {
    const responses = [createResponse({ id: 'cool object' })];
    initializeRequestHook(responses);
    requestor.get(`${urlHost}/singlePageResource`).then(response => {
      const result = response.body;
      expect(result.id).to.equal('cool object');
      const activity = response.activity[0];
      expect(activity.attempts).to.equal(1);
    });
  });

  it('should be able to use get() on the same requestor twice', () => {
    const instance = requestor.defaults();
    let responses = [createResponse({ id: 'cool object' })];
    initializeRequestHook(responses);
    instance.get(`${urlHost}/singlePageResource`).then(response => {
      const result = response.body;
      expect(result.id).to.equal('cool object');
      const activity = response.activity[0];
      expect(activity.attempts).to.equal(1);
    });
    responses = [createResponse({ id: 'second object' })];
    initializeRequestHook(responses);
    instance.get(`${urlHost}/singlePageResource`).then(response => {
      const result = response.body;
      expect(result.id).to.equal('second object');
      const activity = response.activity[0];
      expect(activity.attempts).to.equal(1);
    });
  });

  it('should be able to get a multi page resource', () => {
    const responses = [
      createMultiPageResponse('twoPageResource', [{ element: 1 }], null, 2),
      createMultiPageResponse('twoPageResource', [{ element: 2 }, { element: 3 }], 1, null)
    ];
    const requestTracker = [];
    initializeRequestHook(responses, requestTracker);
    return requestor.getAll(`${urlHost}/twoPageResource`, defaultOptions).then(result => {
      expect(result.length).to.equal(3);
      expect(result[0].element).to.equal(1);
      expect(result[1].element).to.equal(2);
      expect(result[2].element).to.equal(3);

      expect(result.activity.length).to.equal(2);
      expect(result.activity[0].attempts).to.equal(1);
      expect(result.activity[1].attempts).to.equal(1);

      expect(requestTracker.length).to.equal(2);
      expect(requestTracker[0]).to.not.include('?page=1');
      expect(requestTracker[0]).to.not.include('&page=1');
      expect(requestTracker[0]).to.include('per_page');
      expect(requestTracker[1]).to.include('page=2');
      expect(requestTracker[1]).to.include('per_page');
    }, err => {
      assert.fail();
    });
  });

  it('should be able to getAll twice on a multi page resource', () => {
    const instance = requestor.defaults(defaultOptions);
    let responses = [
      createMultiPageResponse('twoPageResource', [{ page: 1 }], null, 2),
      createMultiPageResponse('twoPageResource', [{ page: 2 }], 1, null)
    ];
    let requestTracker = [];
    initializeRequestHook(responses, requestTracker);
    result1 = instance.getAll(`${urlHost}/twoPageResource`).then(result => {
      expect(result.length).to.equal(2);
      expect(result[0].page).to.equal(1);
      expect(result[1].page).to.equal(2);
      expect(result.activity[0].attempts).to.equal(1);
      expect(result.activity[1].attempts).to.equal(1);

      expect(requestTracker.length).to.equal(2);
      expect(requestTracker[0]).to.not.include('?page=1');
      expect(requestTracker[0]).to.not.include('&page=1');
      expect(requestTracker[0]).to.include('per_page');
      expect(requestTracker[1]).to.include('page=2');
      expect(requestTracker[1]).to.include('per_page');
    }, err => {
      assert.fail();
    });

    return result1.then(() => {
      responses = [
        createMultiPageResponse('twoPageResource', [{ page: 3 }], null, 2),
        createMultiPageResponse('twoPageResource', [{ page: 4 }], 1, null)
      ];
      requestTracker = [];
      initializeRequestHook(responses, requestTracker);
      return instance.getAll(`${urlHost}/twoPageResource`).then(result => {
        expect(result.length).to.equal(2);
        expect(result[0].page).to.equal(3);
        expect(result[1].page).to.equal(4);
        expect(result.activity[0].attempts).to.equal(1);
        expect(result.activity[1].attempts).to.equal(1);

        expect(requestTracker.length).to.equal(2);
        expect(requestTracker[0]).to.not.include('?page=1');
        expect(requestTracker[0]).to.not.include('&page=1');
        expect(requestTracker[0]).to.include('per_page');
        expect(requestTracker[1]).to.include('page=2');
        expect(requestTracker[1]).to.include('per_page');
      }, err => {
        assert.fail();
      });
    });
  });

  it('should retry 500 errors and eventually fail', () => {
    const responses = [
      createResponse('bummer', 500, 'Server Error'),
      createResponse('bummer', 500, 'Server Error'),
      createResponse('bummer', 500, 'Server Error'),
      createResponse('bummer', 500, 'Server Error'),
      createResponse('bummer', 500, 'Server Error')
    ];
    initializeRequestHook(responses);
    return requestor.getAllResponses(`${urlHost}/serverError`, defaultOptions).then(response => {
      expect(response.length).to.be.equal(1);
      expect(response[0].statusCode).to.be.equal(500);
      expect(response.activity.length).to.be.equal(1);
      expect(response.activity[0].attempts).to.be.equal(defaultOptions.maxAttempts);
    }, err => {
      assert.fail();
    });
  });

  it('should retry 500 errors and eventually succeed', () => {
    const responses = [
      createResponse('bummer', 500),
      createResponse({ id: 1 }),
      createResponse({ id: 2 })
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}/retry500succeed`, defaultOptions).then(result => {
      expect(result[0].id).to.equal(1);
      const activity = result.activity[0];
      expect(activity.attempts).to.equal(2);
      expect(activity.delays[0].retry).to.equal(defaultOptions.retryDelay);
    }, err => {
      assert.fail(err);
    });
  });

  it('should not retry errors without response', () => {
    const responses = [
      createErrorResponse('bummer'),
      createErrorResponse('bummer'),
      createErrorResponse('bummer'),
      createErrorResponse('bummer'),
      createErrorResponse('bummer')
    ];
    initializeRequestHook(responses);
    return requestor.getAllResponses(`${urlHost}/networkError`, defaultOptions).then(result => {
      assert.fail();
    }, err => {
      expect(err.message).to.equal('bummer');
      const activity = err.activity[0];
      expect(activity.attempts).to.be.undefined;
      expect(activity.delays[0].retry).to.equal(defaultOptions.retryDelay);
    });
  });

  it('should retry network errors and eventually succeed', () => {
    const responses = [
      createErrorResponse('bummer 1'),
      createErrorResponse('bummer 2'),
      createResponse([{ id: 1 }]),
      createResponse([{ id: 2 }])
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}/retryNetworkErrorSucceed`, defaultOptions).then(result => {
      expect(result[0].id).to.equal(1);
      const activity = result.activity[0];
      expect(activity.attempts).to.equal(3);
      expect(activity.delays.length).to.equal(2);
      expect(activity.delays[0].retry).to.equal(defaultOptions.retryDelay);
      expect(activity.delays[1].retry).to.equal(defaultOptions.retryDelay);
    }, err => {
      assert.fail();
    });
  });

  it('should recover after 403 forbidden', () => {
    const responses = [
      createResponse('forbidden 1', 403),
      createResponse({ id: 1 }),
      createResponse({ id: 2 })
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}/forbidden`, defaultOptions).then(result => {
      expect(result[0].id).to.equal(1);
      const activity = result.activity[0];
      expect(activity.attempts).to.equal(2);
      expect(activity.delays.length).to.equal(1);
      expect(activity.delays[0].forbidden).to.equal(defaultOptions.forbiddenDelay);
    }, err => {
      assert.fail();
    });
  });

  it('should recover after error and deliver all pages', () => {
    const responses = [
      // createMultiPageResponse(target, body, previous, next, last, code = 200, error = null, remaining = 4000) {
      createMultiPageResponse('pagedWithErrors', [{ page: 1 }], null, 2),
      createMultiPageResponse('pagedWithErrors', [{ page: 2 }], 1, null, 2, null, 'bummer'),
      createMultiPageResponse('pagedWithErrors', [{ page: 2 }], 1, null)
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}/pagedWithErrors`, defaultOptions).then(result => {
      expect(result.length).to.equal(2);
      expect(result[0].page).to.equal(1);
      expect(result[1].page).to.equal(2);

      expect(result.activity.length).to.equal(2);
      const activity0 = result.activity[0];
      expect(activity0.attempts).to.equal(1);
      expect(activity0.delays).to.be.undefined;

      const activity1 = result.activity[1];
      expect(activity1.attempts).to.equal(2);
      expect(activity1.delays.length).to.equal(1);
      expect(activity1.delays[0].retry).to.equal(defaultOptions.retryDelay);
    }, err => {
      assert.fail();
    });
  });

  it('should recover after throttling and deliver all pages', () => {
    const responses = [
      createMultiPageResponse('pagedWithErrors', [{ page: 1 }], null, 2, 2, 200, null, 20, Date.now() + 1000),
      createMultiPageResponse('pagedWithErrors', [{ page: 2 }], 1, null)
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}`, defaultOptions).then(result => {
      expect(result.length).to.equal(2);
      expect(result[0].page).to.equal(1);
      expect(result[1].page).to.equal(2);

      expect(result.activity.length).to.equal(2);
      const activity0 = result.activity[0];
      expect(activity0.attempts).to.equal(1);
      expect(activity0.delays).to.be.undefined;
      expect(activity0.rateLimitDelay > 0).to.be.true;

      const activity1 = result.activity[1];
      expect(activity1.attempts).to.equal(1);
      expect(activity1.delays).to.be.undefined;
    }, err => {
      assert.fail();
    });
  });

  it('should deliver result array after throttling', () => {
    const responses = [
      createMultiPageResponse('throttled', [{ page: 1 }], null, null, 1, 200, null, 20, Date.now() + 1000)
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}`, defaultOptions).then(result => {
      expect(result.length).to.equal(1);
      expect(result[0].page).to.equal(1);

      expect(result.activity.length).to.equal(1);
      const activity0 = result.activity[0];
      expect(activity0.attempts).to.equal(1);
      expect(activity0.delays).to.be.undefined;
      expect(activity0.rateLimitDelay > 0).to.be.true;
    }, err => {
      assert.fail();
    });
  });

  it('should deliver single result after throttling', () => {
    const responses = [
      createResponse({ cool: 'object' }, 200, 'OK', 20, Date.now() + 1000)
    ];
    initializeRequestHook(responses);
    return requestor.get(`${urlHost}`, defaultOptions).then(result => {
      expect(Array.isArray(result)).to.be.false;
      expect(result.body.cool).to.equal('object');

      expect(result.activity.length).to.equal(1);
      const activity0 = result.activity[0];
      expect(activity0.attempts).to.equal(1);
      expect(activity0.delays).to.be.undefined;
      expect(activity0.rateLimitDelay > 0).to.be.true;
    }, err => {
      assert.fail();
    });
  });

  it('should fail on non-retryable statusCodes', () => {
    const responses = [
      createResponse(null, 401)
    ];
    initializeRequestHook(responses);
    return requestor.get(`${urlHost}`, defaultOptions).then(
      (response) => {
        expect(response.statusCode).to.be.equal(401);
        expect(response.activity.length).to.be.equal(1);
        expect(response.activity[0].attempts).to.be.equal(1);
      },
      err => {
        assert.fail();
      });
  });

  it('should not fail on 304 responses', () => {
    const responses = [
      createMultiPageResponse('throttled', [{ cool: 'object' }], null, 2, 3),
      createMultiPageResponse('throttled2', null, 1, 3, 3, 304),
      createMultiPageResponse('throttled3', [{ node: 'is fun' }], 2, null, 3),
    ];
    initializeRequestHook(responses);
    return requestor.getAllResponses(`${urlHost}`, defaultOptions).then(response => {
      expect(response.length).to.equal(3);
      expect(response[0].statusCode).to.equal(200);
      expect(response[1].statusCode).to.equal(304);
      expect(response[2].statusCode).to.equal(200);

      expect(response.activity.length).to.equal(3);
      const activity0 = response.activity[0];
      expect(response.activity[0].attempts).to.equal(1);
      expect(response.activity[1].attempts).to.equal(1);
      expect(response.activity[2].attempts).to.equal(1);
    });
  });

  it('should handle etags being passed', () => {
    const responses = [
      create304Response('"42"'),
    ];
    initializeRequestHook(responses);
    const options = requestor.mergeOptions(defaultOptions, { headers: { etag: '"42"' } });
    return requestor.get(`${urlHost}`, defaultOptions).then(response => {
      expect(response.statusCode).to.equal(304);
    });
  });
});

function createRequestor(responses, requestTracker = null) {
  // initialize the hook each time to ensure a fresh copy of the response table
  initializeRequestHook(responses, requestTracker);
}

const defaultOptions = {
  retryDelay: 10,
  forbiddenDelay: 15,
  mode: 'test',
  maxAttempts: 5
};

// hook the node request object to bypass the actual network sending and do the thing we want.
function initializeRequestHook(responseList, requestTracker = null) {
  const responses = responseList.slice();
  const hook = (options, callback) => {
    if (requestTracker) {
      requestTracker.push(options.url);
    }

    // finish the call in a timeout to simulate the network call context switch
    setTimeout(() => {
      result = responses.shift();
      callback(result.error, result.response, result.response ? result.response.body : undefined);
    }, 0);
  };
  request.Request.request = hook;
}

function createResponse(body, code = 200, message = null, remaining = 4000, reset = null) {
  return {
    response: {
      statusCode: code,
      statusMessage: message,
      headers: {
        'x-ratelimit-remaining': remaining,
        'x-ratelimit-reset': reset ? reset : 0,
      },
      body: body
    }
  };
}

function create304Response(etag) {
  return {
    response: {
      statusCode: 304,
      headers: {
        etag: etag
      }
    }
  };
}

function createMultiPageResponse(target, body, previous, next, last, code = 200, error = null, remaining = 4000, reset = null) {
  return {
    error: error,
    response: {
      headers: {
        'x-ratelimit-remaining': remaining,
        'x-ratelimit-reset': reset ? reset : 0,
        link: createLinkHeader(target, previous, next, last)
      },
      statusCode: code,
      body: body
    }
  };
}

function createErrorResponse(error) {
  return {
    error: new Error(error)
  };
}

function createLinkHeader(target, previous, next, last) {
  separator = target.includes('?') ? '&' : '?';
  const firstLink = null; //`<${urlHost}/${target}${separator}page=1>; rel="first"`;
  const prevLink = previous ? `<${urlHost}/${target}${separator}page=${previous}>; rel="prev"` : null;
  const nextLink = next ? `<${urlHost}/${target}${separator}page=${next}>; rel="next"` : null;
  const lastLink = last ? `<${urlHost}/${target}${separator}page=${last}>; rel="last"` : null;
  return [firstLink, prevLink, nextLink, lastLink].filter(value => { return value !== null; }).join(',');
}

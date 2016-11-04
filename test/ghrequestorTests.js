const assert = require('chai').assert;
const chai = require('chai');
const expect = require('chai').expect;
const extend = require('extend');
const requestor = require('../lib/ghrequestor.js');
const request = require('requestretry');

const urlHost = 'https://test.com';

// describe('Request option merging', () => {
//   it('should merge and override properties', () => {
//     const result = new requestor({
//       retryDelay: 10,
//       testProperty: 'test value'
//     });
//     expect(result.options.retryDelay).to.equal(10);
//     expect(result.options.testProperty).to.equal('test value');
//   });

//   it('should merge and override headers', () => {
//     const result = new requestor({
//       headers: {
//         'User-Agent': 'test agent',
//         authorization: 'test auth'
//       }
//     });
//     expect(result.options.headers['User-Agent']).to.equal('test agent');
//     expect(result.options.headers.authorization).to.equal('test auth');
//   });
// });

describe('Request retry and success', () => {
  it('should be able to get a single page resource', () => {
    const responses = [createSingleResponse({ id: 'cool object' })];
    initializeRequestHook(responses);
    requestor.get(`${urlHost}/singlePageResource`).then(response => {
      const result = response.body;
      expect(result.id).to.equal('cool object');
      const activity = response.activity[0];
      expect(activity.attempts).to.equal(1);
    });
  });

  it('should be able to get a multi page resource', () => {
    const responses = [
      createMultiPageResponse('twoPageResource', [{ page: 1 }], null, 2),
      createMultiPageResponse('twoPageResource', [{ page: 2 }], 1, null)
    ];
    const requestTracker = [];
    initializeRequestHook(responses, requestTracker);
    return requestor.getAll(`${urlHost}/twoPageResource`, defaultOptions).then(result => {
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
  });

  it('should retry 500 errors and eventually fail', () => {
    const responses = [
      createSingleResponse('bummer', 500, 'Server Error'),
      createSingleResponse('bummer', 500, 'Server Error'),
      createSingleResponse('bummer', 500, 'Server Error'),
      createSingleResponse('bummer', 500, 'Server Error'),
      createSingleResponse('bummer', 500, 'Server Error')
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}/serverError`, defaultOptions).then(result => {
      assert.fail();
    }, err => {
      // TODO what should be the right return value from a 500?
      // The body of the response or the response itself?
      expect(err.response).to.not.be.null;
      expect(err.message).to.equal('Server Error');
      expect(err.response.body).to.equal('bummer');
      expect(err.response.statusCode).to.equal(500);
      const activity = err.response.activity[0];
      expect(activity.attempts).to.equal(defaultOptions.maxAttempts);
      expect(activity.delays[0].retry).to.equal(defaultOptions.retryDelay);
    });
  });

  it('should retry 500 errors and eventually succeed', () => {
    const responses = [
      createSingleResponse('bummer', 500),
      createSingleResponse({ id: 1 }),
      createSingleResponse({ id: 2 })
    ];
    initializeRequestHook(responses);
    return requestor.getAll(`${urlHost}/retry500succeed`, defaultOptions).then(result => {
      expect(result[0].id).to.equal(1);
      const activity = result.activity[0];
      expect(activity.attempts).to.equal(2);
      expect(activity.delays[0].retry).to.equal(defaultOptions.retryDelay);
    }, err => {
      assert.fail();
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
    return requestor.getAll(`${urlHost}/networkError`, defaultOptions).then(result => {
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
      createSingleResponse({ id: 1 }),
      createSingleResponse({ id: 2 })
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
      createSingleResponse('forbidden 1', 403),
      createSingleResponse({ id: 1 }),
      createSingleResponse({ id: 2 })
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
      createMultiPageResponse('pagedWithErrors', [{ page: 1 }], null, 2, 2, null, null, 20, Date.now() + 1000),
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
      createMultiPageResponse('throttled', [{ page: 1 }], null, null, 1, null, null, 20, Date.now() + 1000)
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
      createSingleResponse({ cool: 'object' }, 200, 'OK', 20, Date.now() + 1000)
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
      createSingleResponse(null, 401)
    ];
    initializeRequestHook(responses);
    return requestor.get(`${urlHost}`, defaultOptions).then(
      () => {
        assert.fail();
      },
      err => {
        expect(err instanceof Error).to.be.true;
        expect(err.response.statusCode).to.be.equal(401);

        expect(err.activity.length).to.equal(1);
        const activity0 = err.activity[0];
        expect(activity0.attempts).to.equal(1);
        expect(activity0.delays).to.be.undefined;
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

function createSingleResponse(body, code = 200, message = null, remaining = 4000, reset = null) {
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

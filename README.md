![Version](https://img.shields.io/npm/v/ghrequestor.svg)
![License](https://img.shields.io/github/license/Microsoft/ghrequestor.svg)
![Downloads](https://img.shields.io/npm/dt/ghrequestor.svg)

# GHRequestor
A simple, resilient GitHub API client that:

* Is great for bulk fetching of resources from the GitHub API.
* Retries on errors and various forms of rate-limiting.
* Backs off as you reach your API limit.
* Automatically fetches all pages of a multi-page resource.
* Uses etags to conserve API tokens and be kind to GitHub.
* Reports comprehensive data on number of pages fetched, retry attempts, and length of delays.

GHRequestor is a relatively low-level facility intended for traversing large graphs of GitHub resources.
Its primary usecase is [GHCrawler](https://github.com/Microsoft/ghcrawler), an engine that walks subsections of GitHub collecting related resources.
This not intended to replace great modules like [octonode](https://www.npmjs.com/package/octonode) or [github](https://www.npmjs.com/package/github).

## Usage

The API is modelled after the standard node `request` library. It works with promises or callbacks and allows you to create pre-initialized requestor instances (with options setup) for injection into subsystems etc.

Simple GET of a single page
```javascript
const ghrequestor = require('ghrequestor');
ghrequestor.get('https://api.github.com/repos/Microsoft/ghrequestor').then(response => {
  console.log(response.body);
});
```

GET a resource that spans multiple pages and flatten the responses into a single array. Notice the result includes
an *activity* property detailing the requests and responses that went into getting the final result.  You can swap `getAll` with `getAllResponses` to get back the raw responses rather than flattened array of values. 
```javascript
const ghrequestor = require('ghrequestor');
ghrequestor.getAll('https://api.github.com/repos/Microsoft/ghrequestor/commits').then(result => {
  console.log(result.length);
  console.log(result.activity.length);
  console.log(result.activity[0].attempts);
});
```

GET with a set of etags and a content *supplier* that has the etagged resources.  With this you can integrate an in-memory or persistent cache of GitHub resources and let ghrequestor optimize the fetching and your use of API tokens. It's nicer on the GitHub infrastructure as well.  Notice that the etag value include the `"`s.
```javascript
const ghrequestor = require('ghrequestor');
const url = <some url>;
ghrequestor.getAllResponses(url, { etags: ['"42"']}).then(responses => {
  const supplier = url => { return yourContentLookupCode(); };
  return ghrequestor.flattenResponses(responses, supplier).then(results => {
    console.log(results.length);
  });
});
```

## Authentication

Authentication is handled the same as with Node's `request` when using optoins and headers. You can either pass the `authorization` header in with each call or create a request template that has the `authorization` header set.

```javascript
ghrequestor.get(url, { authorization: 'token <my token here>' });
```
Or
```javascript
const requestorTemplate = ghrequestor.defaults({ authorization: 'token <my token here>' });
requestorTemplate.get(url);
```

## Retries

Retry logic is provided by [requestretry](https://www.npmjs.com/package/requestretry), which means you can pass `maxAttempts` and `retryDelay` as options:

```javascript
ghrequestor.get(url, { maxAttempts: 2, retryDelay: 1000 });
```

Alternatively, you can pass in a `retryStrategy` (or `delayStrategy`). For example:

```javascript
ghrequestor.get(url, { retryStrategy: ghrequestor.RetryStrategies.HTTPOrNetworkError });
```

These are the same as [those of the underlying library](https://github.com/FGRibreau/node-request-retry/tree/v1.12.0/strategies/).

## Logging

ghrequestor takes a [winston](https://www.npmjs.com/package/winston)-style logger as a `logger` option. Set that option on each call or in a template

```javascript
const winston = require('winston');
const requestorTemplate = ghrequestor.defaults({ logger: winston });
requestorTemplate.get(url);
```

# Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.microsoft.com.  

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.  

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

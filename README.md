![Version](https://img.shields.io/npm/v/ghrequestor.svg)
![License](https://img.shields.io/github/license/Microsoft/ghrequestor.svg)
![Downloads](https://img.shields.io/npm/dt/ghrequestor.svg)

# GHRequestor
A simple, resilient GitHub API client that:

* Is great for bulk fetching of resources from the GitHub API.
* Retries on errors and various forms of rate-limiting.
* Backs off as you reach your API limit.
* Automatically fetches all pages of a multi-page resource.
* Reports comprehensive data on number of pages fetched, retry attempts, and length of delays.

GHRequestor is a relatively low-level facility intended for traversing large graphs of GitHub resources.
Its primary usecase is [GHCrawler](https://github.com/Microsoft/ghcrawler), an engine that walks subsections of GitHub collecting related resources.
This not intended to replace great modules like [octonode](https://www.npmjs.com/package/octonode) or [github](https://www.npmjs.com/package/github).

## Usage

The API is modelled after the standard node `request` libarary and the underlying [requestretry](https://www.npmjs.com/package/requestretry) library. It works with promises or callbacks and allows you to create pre-initialized requestor instances (with options setup) for injection into subsystems etc.

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
ghrequestor.getAllResponses('https://api.github.com/repos/Microsoft/ghrequestor/commits', { etags: ['"42"']}).then(responses => {
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

```javascript
const requestorTemplate = ghrequestor.defaults({ authorization: 'token <my token here>' });
requestorTemplate.get(url);
```

## Logging

ghrequestor takes a [winston](https://www.npmjs.com/package/winston)-style logger as a `logger` option. Set that option on each call or in a template

```javascript
const winston = require('winston');
const requestorTemplate = ghrequestor.defaults({ logger: winston });
requestorTemplate.get(url);
```

# Contributing

The project team is more than happy to take contributions and suggestions.

To start working, clone the repo and run ```npm install``` in the repository folder to install the required dependencies. The tests are a great place start understanding the code in more detail.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

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
Its primary usecase is GHCrawler, an engine that walks subsections of GitHub collecting related resources.
This not intended to replace great modules like octonode or github.

# Examples

Coming...

# Contributing

The project team is more than happy to take contributions and suggestions.

To start working, run ```npm install``` in the repository folder to install the required dependencies.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
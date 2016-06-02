(function() {
  // semi-global object to hang methods on so they're available even when
  // `this` has changed
  var txgh = {};

  // Default configuration options. Set config by using the little icon for
  // this extension that appears to the right of the omnibox (i.e. URL bar).
  var defaultConfig = {
    // Your Github token to use when communicating with the Github API. I'd
    // suggest creating a personal access token for use with this extension
    // as opposed to an oauth token.
    githubToken: null,

    // A map of Transifex project slugs to Github repositories.
    projectMap: {},

    // A map of Transifex organizations to Github organizations.
    organizationMap: {},

    // List of regexes to identify links in the bodies of pull requests. These
    // links will appear in the "Links" section in Transifex.
    linkRegexes: [
      "(https?:\\/\\/[\\w.]+atlassian\\.net\\/[\\/\\w-]+)"
    ]
  };

  // basically main
  chrome.runtime.onConnect.addListener(function(port) {
    port.onMessage.addListener(function(message, port) {
      switch(message.method) {
        // triggered whenever the content script wants to refresh the page/tab
        case 'updateTab':
          txgh.triggerTabUpdate(port, port.sender.tab);
          break;

        // The response to the getResource message, sent from the content script.
        // Since the content script is the only code that can access the DOM,
        // the background script has to send the getResource message to pull
        // the name of the branch off the page. The content script uses jQuery
        // to grab the branch name (i.e. resource name), then hands it back to
        // the background script via the getResourceResponse message.
        case 'getResourceResponse':
          var tab = port.sender.tab;

          if (message.tabId !== tab.id) {
            return;
          }

          txgh.getConfig().then(function(config) {
            var routeInfo = txgh.getRouteInfo(tab.url, config);
            var branch = txgh.branchFromResource(message.resource);
            var pullRequest = txgh.findPullRequestForBranch(routeInfo, branch, config);
            txgh.updateTab(port, pullRequest, config);
          });

          break;

        // The popup script can ask for the current configuration by sending
        // this message. Config is stored in Chrome's extension-specific local
        // storage.
        case 'getConfig':
          txgh.getConfig().then(function(config) {
            port.postMessage({config: config, method: 'getConfigResponse'});
          });

          break;

        // The popup script can ask to save a new version of the configuration
        // by sending this message.
        case 'setConfig':
          txgh.setConfig(message.config);
          break;
      }
    });
  });

  // Sends the getResource message to the content script, which is the first
  // message in a series of back-and-forth messages that eventually add links
  // to the page/tab.
  txgh.triggerTabUpdate = function(port, tab) {
    txgh.getConfig().then(function(config) {
      if (config.githubToken == null) {
        console.log('Github token not set. Configure one in your preferences.');
        return;
      }

      var routeInfo = txgh.getRouteInfo(tab.url, config);

      // if routeInfo is null, the current tab isn't on transifex.com and we
      // don't care about it
      if (routeInfo != null) {
        port.postMessage({tabId: tab.id, method: 'getResource'});
      }
    });
  };

  // Adds links from the pull request to the page/tab.
  txgh.updateTab = function(port, pullRequest, config) {
    var tab = port.sender.tab;

    pullRequest.then(function(pull) {
      var links = [];

      if (pull !== null) {
        links.push(pull.htmlUrl);

        // this prototype push thing adds all the elements from extractLinks
        // to the links array (it's like push, but for multiple elements)
        Array.prototype.push.apply(links, txgh.extractLinks(pull.body, config));
      }

      // tell the content script to update the page/tab with the links
      port.postMessage({
        tabId: tab.id, method: 'updateLinks', links: links
      });
    });
  };

  // Uses the list of configured regexes to pull links out of the body of the
  // given pull request.
  txgh.extractLinks = function(text, config) {
    var links = [];

    for (var regIdx in config.linkRegexes) {
      var matches = text.match(new RegExp(config.linkRegexes[regIdx]));

      if (matches != null) {
        for (var matchIdx = 0; matchIdx < matches.length; matchIdx ++) {
          // weed out duplicates
          if (links.indexOf(matches[matchIdx]) === -1) {
            links.push(matches[matchIdx]);
          }
        }
      }
    }

    return links;
  };

  // Queries the Github API for the pull request associated with the given
  // branch.
  txgh.findPullRequestForBranch = function(routeInfo, branch, config) {
    return txgh.getFromStorage(branch).then(function(pull) {
      if (txgh.isEmptyObject(pull)) {
        var octo = new Octokat({token: config.githubToken});
        // FYI this doesn't actually make a web request
        var repo = octo.repos(routeInfo.ghOrganization, routeInfo.repo);
        // a "label" is Githubbian terminology for "org:branch"
        var label = routeInfo.ghOrganization + ':' + branch;
        return txgh.findPullRequestForLabel(label, repo, branch);
      } else {
        return pull[branch];
      }
    });
  };

  // Actually does the Github querying and caches the resulting pull request
  // object in local storage.
  txgh.findPullRequestForLabel = function(label, repo, branch) {
    return repo.pulls.fetch({head: label}).then(function(pulls) {
      if (pulls.length > 0) {
        var pair = {};
        pair[branch] = pulls[0];
        chrome.storage.local.set(pair);
        return pulls[0];
      } else {
        return null;
      }
    });
  };

  // Convenience method that grabs stuff from local storage and wraps it in a
  // promise. Local storage traditionally uses callbacks, but I kept getting
  // caught in callback hell.
  txgh.getFromStorage = function(keys) {
    return new Promise(function(resolve, reject) {
      chrome.storage.local.get(keys, function(value) {
        resolve(value);
      });
    });
  };

  // Gets the current config from local storage and returns a promise. If there
  // is no config set, this function saves a default config object to local
  // storage and returns it.
  txgh.getConfig = function() {
    return txgh.getFromStorage('config').then(function(config) {
      if (txgh.isEmptyObject(config.config)) {
        txgh.setConfig({config: defaultConfig})
        return defaultConfig;
      } else {
        return config.config;
      }
    });
  };

  // Utility function to determine if an object has no keys and values of its
  // own. Mainly used in conjunction with reading stuff from local storage,
  // since local storage will return an empty object if it can't find the keys
  // you pass to it.
  txgh.isEmptyObject = function(obj) {
    if (obj) {
      for (var prop in obj) {
        return false;
      }
    }

    return true;
  };

  // Writes the given config object to local storage.
  txgh.setConfig = function(config) {
    chrome.storage.local.set({config: config});
  };

  // By default, txgh sets the resource's resource name to a combination of the
  // source file the resource came from (eg. config/locales/en.yml) and the
  // branch name in parentheses. Txgh also attaches the branch name to the
  // resource as a "category", but unfortunately categories aren't visible in
  // the Transifex web editor. Instead, we have to find the resource name on
  // the page and pull the branch out of the parentheses.
  txgh.branchFromResource = function(resource) {
    var idx = resource.indexOf('(heads/') + 7;
    return resource.slice(idx, resource.length - 1);
  };

  // Inspects the given URL and identifies the organization, project slug, and
  // other important values. If this function returns null, the URL isn't one
  // we care about, i.e. isn't on transifex.com, etc.
  txgh.getRouteInfo = function(url, config) {
    var regexpStr = [
      "transifex.com/",  // base url
      "([^/]+)/",        // organization (eg. lumos-labs)
      "([^/]+)/",        // project slug (eg. beacon-1 or lumosityandroid)
      "translate/",      // literal "translate/" text
      "#([^/]+)/",       // locale code, preceeded by a "#"
      "([^/]+)",         // resource slug (eg. enyml-heads_master)
    ].join('');

    var regexp = new RegExp(regexpStr);
    var match = url.match(regexp);

    if (match == null) {
      return null;
    }

    var routeInfo = {
      txOrganization: match[1],
      projectSlug: match[2],
      locale: match[3],
      resourceSlug: match[4]
    };

    // The URL itself can only tell us so much. In order to query Github, we
    // have to map the Transifex project and organization to their corresponding
    // Github repo and organization. It would be great if all these were
    // equivalent, but that's not always true. For example, Lumos is "lumos-labs"
    // on Transifex but "lumoslabs" on Github.
    routeInfo.repo = txgh.ghRepoFor(routeInfo.projectSlug, config.projectMap);
    routeInfo.ghOrganization = txgh.ghOrgFor(routeInfo.txOrganization, config.organizationMap);

    return routeInfo;
  };

  // Returns the Github organization that corresponds to the given Transifex
  // organization. If no mapping exists, this function returns the given
  // organization name unmodified.
  txgh.ghOrgFor = function(txOrg, organizationMap) {
    var mappedOrg = organizationMap[txOrg];

    // fall back to original org, i.e. don't map
    if (mappedOrg == null) {
      return txOrg;
    } else {
      return mappedOrg;
    }
  };

  // Returns the Github repo that corresponds to the given Transifex project
  // slug. If no mapping exists, this function returns the given project slug
  // unmodified.
  txgh.ghRepoFor = function(projectSlug, projectMap) {
    var mappedSlug = projectMap[projectSlug];

    // fall back to original slug, i.e. don't map
    if (mappedSlug == null) {
      return projectSlug;
    } else {
      return mappedSlug;
    }
  };
})();

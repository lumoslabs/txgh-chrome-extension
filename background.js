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
        case 'updateTab':
          txgh.triggerTabUpdate(port, port.sender.tab);
          break;

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

        case 'getConfig':
          txgh.getConfig().then(function(config) {
            port.postMessage({config: config, method: 'getConfigResponse'});
          });

          break;

        case 'setConfig':
          txgh.setConfig(message.config);
          break;
      }
    });
  });

  txgh.triggerTabUpdate = function(port, tab) {
    txgh.getConfig().then(function(config) {
      if (config.githubToken == null) {
        console.log('Github token not set. Configure one in your preferences.');
        return;
      }

      var routeInfo = txgh.getRouteInfo(tab.url, config);

      if (routeInfo != null) {
        port.postMessage({tabId: tab.id, method: 'getResource'});
      }
    });
  };

  txgh.updateTab = function(port, pullRequest, config) {
    var tab = port.sender.tab;

    pullRequest.then(function(pull) {
      var links = [];

      if (pull !== null) {
        links.push(pull.htmlUrl);
        Array.prototype.push.apply(links, txgh.extractLinks(pull.body, config));
      }

      port.postMessage({
        tabId: tab.id, method: 'updateLinks', links: links
      });
    });
  };

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
  }

  txgh.findPullRequestForBranch = function(routeInfo, branch, config) {
    return txgh.getFromStorage(branch).then(function(pull) {
      if (txgh.isEmptyObject(pull)) {
        var octo = new Octokat({token: config.githubToken});
        var repo = octo.repos(routeInfo.ghOrganization, routeInfo.repo);
        var label = routeInfo.ghOrganization + ':' + branch;
        return txgh.findPullRequestForLabel(label, repo, branch);
      } else {
        return pull[branch];
      }
    });
  };

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
  }

  txgh.getFromStorage = function(keys) {
    return new Promise(function(resolve, reject) {
      chrome.storage.local.get(keys, function(value) {
        resolve(value);
      });
    });
  }

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

  txgh.isEmptyObject = function(obj) {
    if (obj) {
      for (var prop in obj) {
        return false;
      }
    }

    return true;
  };

  txgh.setConfig = function(config) {
    chrome.storage.local.set({config: config});
  };

  txgh.branchFromResource = function(resource) {
    var idx = resource.indexOf('(heads/') + 7;
    return resource.slice(idx, resource.length - 1);
  };

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

    routeInfo.repo = txgh.ghRepoFor(routeInfo.projectSlug, config.projectMap);
    routeInfo.ghOrganization = txgh.ghOrgFor(routeInfo.txOrganization, config.organizationMap);

    return routeInfo;
  };

  txgh.ghOrgFor = function(txOrg, organizationMap) {
    var mappedOrg = organizationMap[txOrg];

    // fall back to original org, i.e. don't map
    if (mappedOrg == null) {
      return txOrg;
    } else {
      return mappedOrg;
    }
  };

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

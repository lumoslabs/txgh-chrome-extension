(function() {
  // Chrome requires that you communicate between background scripts (i.e.
  // scripts that run in the background and don't have access to the DOM) and
  // content scripts (i.e. scripts that DO have access to the DOM but not any
  // of the tab metadata) by passing messages. Message passing can be done in
  // two ways depending on if you need to pass messages once or continuously.
  // One-time connections expire after the response is sent, i.e. the listener
  // can't and won't receive more than one response. Long-lived connections
  // don't expire and use Chrome's "port" interface.

  // Listen for events from the background script.
  var listener = (function(message, port) {
    switch(message.method) {
      // Grabs the resource name from the DOM. Sent by the background script
      // whenever the page/tab should be populated with links.
      case 'getResource':
        var resource = $('#js-details-resource').text();

        port.postMessage({
          tabId: message.tabId, resource: resource, method: 'getResourceResponse'
        });

        break;

      // Sent by the background script. Actually updates the page with the list
      // of passed-in links.
      case 'updateLinks':
        var detailsList = $('#details-list');
        var dt = $("dt[for='links']", detailsList);
        var dd = $("dd[for='links']", detailsList);

        // remove the links elements if no links were passed in
        if (message.links.length == 0) {
          dt.remove();
          dd.remove();
          return;
        }

        var linkHrefs = [];

        for (var i = 0; i < message.links.length; i ++) {
          linkHrefs.push(
            '<a target="_blank" href="' + message.links[i] + '">' + message.links[i] + '</a>'
          );
        }

        // if the header doesn't exist, add it to the DOM
        if (dd.length === 0) {
          dd = $('<dd for="links" style="margin-bottom: 20px"></dd>');
          detailsList.prepend(dd);
        }

        // if the body doesn't exist, add it to the DOM
        if (dt.length === 0) {
          dt = $('<dt for="links">Links:</dt>');
          detailsList.prepend(dt);
        }

        // fill in the body
        dd.html(linkHrefs.join('<br>'));

        // Adding the links pushes some of the other content down so it isn't
        // visible or scrollable. This line forces the page to resize so the
        // scrollbars are recalculated and you can actually see/scroll all the
        // content.
        window.dispatchEvent(new Event('resize'));

        break;
    }

    // return true to indicate the response will be sent asynchronously (this
    // may no longer be necessary since we're using ports now)
    return true;
  });

  var checkExist = null;

  // Called whenever the page loads or the URL hash changes. Watches for the
  // resource name element to exist, then sends the updateTab message to the
  // background script to start the ball rolling.
  var watchAndUpdate = function() {
    $('#js-details-resource').text('');

    var port = chrome.runtime.connect({name: 'txgh'});
    port.onMessage.addListener(listener);

    if (checkExist != null) {
      clearInterval(checkExist);
      checkExist = null;
    }

    // continually check to see if the element is available and has content
    checkExist = setInterval(function() {
      var resource = $('#js-details-resource').text();
      if (resource.length > 0) {
        clearInterval(checkExist);
        checkExist = null;
        port.postMessage({method: 'updateTab'});
      }
    }, 500); // check every 500ms
  }

  // watch for changes when the page loads and when the URL hash changes
  $(window).on('hashchange', watchAndUpdate);
  $(document).ready(watchAndUpdate);
})();

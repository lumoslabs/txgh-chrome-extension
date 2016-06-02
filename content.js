(function() {
  var port = chrome.runtime.connect({name: 'txgh'});

  var listener = (function(message, port) {
    switch(message.method) {
      case 'getResource':
        var resource = $('#js-details-resource').text();

        port.postMessage({
          tabId: message.tabId, resource: resource, method: 'getResourceResponse'
        });

        break;

      case 'updateLinks':
        var detailsList = $('#details-list');
        var dt = $("dt[for='links']", detailsList);
        var dd = $("dd[for='links']", detailsList);

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

        if (dd.length === 0) {
          dd = $('<dd for="links" style="margin-bottom: 20px"></dd>');
          detailsList.prepend(dd);
        }

        if (dt.length === 0) {
          dt = $('<dt for="links">Links:</dt>');
          detailsList.prepend(dt);
        }

        dd.html(linkHrefs.join('<br>'));

        // Adding the links pushes some of the other content down so it isn't
        // visible or scrollable. This line forces the page to resize so the
        // scrollbars are recalculated.
        window.dispatchEvent(new Event('resize'));

        break;
    }

    // return true to indicate the response will be sent asynchronously
    return true;
  });

  var checkExist = null;

  var watchAndUpdate = function() {
    $('#js-details-resource').text('');
    port.onMessage.addListener(listener);

    if (checkExist != null) {
      clearInterval(checkExist);
      checkExist = null;
    }

    checkExist = setInterval(function() {
      var resource = $('#js-details-resource').text();
      if (resource.length > 0) {
        clearInterval(checkExist);
        checkExist = null;
        port.postMessage({method: 'updateTab'});
      }
    }, 500); // check every 500ms
  }

  $(window).on('hashchange', watchAndUpdate);
  $(document).ready(watchAndUpdate);
})();

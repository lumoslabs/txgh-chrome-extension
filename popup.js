$(document).ready(function() {
  var textArea = $('#text-area');
  var saveBtn = $('#save-btn');
  var errorPara = $('#error');

  var port = chrome.runtime.connect({name: 'txgh'});

  port.onMessage.addListener(function(message, port) {
    switch(message.method) {
      case 'getConfigResponse':
        textArea.text(JSON.stringify(message.config, null, 2));
    }
  });

  port.postMessage({method: 'getConfig'})

  saveBtn.click(function(e) {
    try {
      var newConfig = JSON.parse(textArea.val());
      var params = {method: 'setConfig', config: newConfig};
      port.postMessage(params);
      window.close();
    } catch(e) {
      errorPara.text("Hmm looks like the config you entered isn't valid JSON.");
    }
  });
});

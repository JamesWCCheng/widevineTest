const KEYSYSTEM_TYPE2 = "org.w3.clearkey";
const KEYSYSTEM_TYPE = "com.widevine.alpha";
function info(message) {console.log(message);}
function Log(message1, message2) {console.log(message1 + "@@" + message2);}
function IsMacOSSnowLeopardOrEarlier() {
  var re = /Mac OS X (\d+)\.(\d+)/;
  var ver = navigator.userAgent.match(re);
  if (!ver || ver.length != 3) {
    return false;
  }
  var major = ver[1] | 0;
  var minor = ver[2] | 0;
  return major == 10 && minor <= 6;
}

function bail(message)
{
  return function(err) {
    if (err) {
      message +=  "; " + String(err)
    }
    //ok(false, message);
    if (err) {
      info(String(err));
    }
    //SimpleTest.finish();
  }
}

function ArrayBufferToString(arr)
{
  var str = '';
  var view = new Uint8Array(arr);
  for (var i = 0; i < view.length; i++) {
    str += String.fromCharCode(view[i]);
  }
  return str;
}

function StringToArrayBuffer(str)
{
  var arr = new ArrayBuffer(str.length);
  var view = new Uint8Array(arr);
  for (var i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }
  return arr;
}

function StringToHex(str){
  var res = "";
  for (var i = 0; i < str.length; ++i) {
      res += ("0" + str.charCodeAt(i).toString(16)).slice(-2);
  }
  return res;
}

function Base64ToHex(str)
{
  var bin = window.atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  var res = "";
  for (var i = 0; i < bin.length; i++) {
    res += ("0" + bin.charCodeAt(i).toString(16)).substr(-2);
  }
  return res;
}

function HexToBase64(hex)
{
  var bin = "";
  for (var i = 0; i < hex.length; i += 2) {
    bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return window.btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function TimeRangesToString(trs)
{
  var l = trs.length;
  if (l === 0) { return "-"; }
  var s = "";
  var i = 0;
  for (;;) {
    s += trs.start(i) + "-" + trs.end(i);
    if (++i === l) { return s; }
    s += ",";
  }
}

function SourceBufferToString(sb)
{
  return ("SourceBuffer{"
    + "AppendMode=" + (sb.AppendMode || "-")
    + ", updating=" + (sb.updating ? "true" : "false")
    + ", buffered=" + TimeRangesToString(sb.buffered)
    + ", audioTracks=" + (sb.audioTracks ? sb.audioTracks.length : "-")
    + ", videoTracks=" + (sb.videoTracks ? sb.videoTracks.length : "-")
    + "}");
}

function SourceBufferListToString(sbl)
{
  return "SourceBufferList[" + sbl.map(SourceBufferToString).join(", ") + "]";
}

function HttpRequest(medthod/*POST or GET*/, url, headers, onXhrLoaded, postData, responseType)
{
  var xhr = new XMLHttpRequest();
  xhr.open("POST", url);
  xhr.addEventListener('load', onXhrLoaded);
  if (headers) {
    for (var [key, value] of headers) {
      xhr.setRequestHeader(key, value);
    }
  }
  if (responseType) { xhr.responseType = responseType;}
  xhr.send(postData);

}

function MaybeCrossOriginURI(test, uri)
{
  if (test.crossOrigin) {
    return "http://test2.mochi.test:8888/tests/dom/media/test/allowed.sjs?" + uri;
  } else {
    return uri;
  }
}

function AppendTrack(test, ms, track, token, loadParams)
{
  return new Promise(function(resolve, reject) {
    var sb;
    var curFragment = 0;
    var resolved = false;
    var fragments = track.fragments;
    var fragmentFile;

    if (loadParams && loadParams.onlyLoadFirstFragments) {
      fragments = fragments.slice(0, loadParams.onlyLoadFirstFragments);
    }

    function addNextFragment() {
      if (curFragment >= fragments.length) {
        Log(token, track.name + ": end of track");
        resolve();
        resolved = true;
        return;
      }

      fragmentFile = MaybeCrossOriginURI(test, fragments[curFragment++]);

      var req = new XMLHttpRequest();
      req.open("GET", fragmentFile);
      req.responseType = "arraybuffer";

      req.addEventListener("load", function() {
        Log(token, track.name + ": fetch of " + fragmentFile + " complete, appending" + req.response);
        try {
               sb.appendBuffer(new Uint8Array(req.response));
        }
        catch (e) {
            info(e);
        }

      });

      req.addEventListener("error", function(){info(token + " error fetching " + fragmentFile);});
      req.addEventListener("abort", function(){info(token + " aborted fetching " + fragmentFile);});

      Log(token, track.name + ": addNextFragment() fetching next fragment " + fragmentFile);
      req.send(null);
    }

    Log(token, track.name + ": addSourceBuffer(" + track.type + ")");
    sb = ms.addSourceBuffer(track.type);
    sb.addEventListener("updateend", function() {
      if (ms.readyState == "ended") {
        /* We can get another updateevent as a result of calling ms.endOfStream() if
           the highest end time of our source buffers is different from that of the
           media source duration. Due to bug 1065207 this can happen because of
           inaccuracies in the frame duration calculations. Check if we are already
           "ended" and ignore the update event */
        Log(token, track.name + ": updateend when readyState already 'ended'");
        if (!resolved) {
          // Needed if decoder knows this was the last fragment and ended by itself.
          Log(token, track.name + ": but promise not resolved yet -> end of track");
          resolve();
          resolved = true;
        }
        return;
      }
      Log(token, track.name + ": updateend for " + fragmentFile + ", " + SourceBufferToString(sb));
      addNextFragment();
    });

    addNextFragment();
  });
}

//Returns a promise that is resolved when the media element is ready to have
//its play() function called; when it's loaded MSE fragments.
function LoadTest(test, elem, token, loadParams)
{
  if (!test.tracks) {
    //ok(false, token + " test does not have a tracks list");
    return Promise.reject();
  }

  var ms = new MediaSource();
  elem.src = URL.createObjectURL(ms);

  return new Promise(function (resolve, reject) {
    var firstOpen = true;
    ms.addEventListener("sourceopen", function () {
      if (!firstOpen) {
        Log(token, "sourceopen again?");
        return;
      }

      firstOpen = false;
      Log(token, "sourceopen");
      return Promise.all(test.tracks.map(function(track) {
        return AppendTrack(test, ms, track, token, loadParams);
      })).then(function(){
        if (loadParams && loadParams.noEndOfStream) {
          Log(token, "Tracks loaded");
        } else {
          Log(token, "Tracks loaded, calling MediaSource.endOfStream()");
          ms.endOfStream();
        }
        resolve();
      });
    })
  });
}

// Same as LoadTest, but manage a token+"_load" start&finished.
// Also finish main token if loading fails.
function LoadTestWithManagedLoadToken(test, elem, manager, token, loadParams)
{
  manager.started(token + "_load");
  return LoadTest(test, elem, token, loadParams)
  .catch(function (reason) {
    //ok(false, TimeStamp(token) + " - Error during load: " + reason);
    manager.finished(token + "_load");
    manager.finished(token);
  })
  .then(function () {
    manager.finished(token + "_load");
  });
}

function SetupEME(test, token, params)
{
  var v = document.createElement("video");
  v.crossOrigin = test.crossOrigin || false;
  v.sessions = [];

  v.closeSessions = function() {
    return Promise.all(v.sessions.map(s => s.close().then(() => s.closed))).then(
      () => {
        v.setMediaKeys(null);
        if (v.parentNode) {
          v.parentNode.removeChild(v);
        }
        v.onerror = null;
        v.src = null;
      });
  };

  // Log events dispatched to make debugging easier...
  [ "canplay", "canplaythrough", "ended", "error", "loadeddata",
    "loadedmetadata", "loadstart", "pause", "play", "playing", "progress",
    "stalled", "suspend", "waiting",
  ].forEach(function (e) {
    v.addEventListener(e, function(event) {
      Log(token, "~~~~" + e + "~~~" + event);
    }, false);
  });

  // Finish the test when error is encountered.
  v.onerror = bail(token + " got error event");

  var onSetKeysFail = (params && params.onSetKeysFail)
    ? params.onSetKeysFail
    : bail(token + " Failed to set MediaKeys on <video> element");

  // null: No session management in progress, just go ahead and update the session.
  // [...]: Session management in progress, add [initDataType, initData] to
  //        this queue to get it processed when possible.
  var initDataQueue = [];
  function processInitDataQueue()
  {
    if (initDataQueue === null) { return; }
    if (initDataQueue.length === 0) { initDataQueue = null; return; }
    var ev = initDataQueue.shift();

    var sessionType = (params && params.sessionType) ? params.sessionType : "temporary";
    Log(token, "createSession(" + sessionType + ") for (" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + ")");
    var session = v.mediaKeys.createSession(sessionType);
    if (params && params.onsessioncreated) {
      params.onsessioncreated(session);
    }
    v.sessions.push(session);

    return new Promise(function (resolve, reject) {
    session.addEventListener("message", function(ev) {
      var msgEventType = ev.messageType;
      var msgStr = ArrayBufferToString(ev.message);
      console.log(msgEventType);
      if (msgEventType == 'individualization-request') {
        // Do the certification process.
        var url = msgStr;
        var headers = new Map();
        headers.set("Content-type", "application/json");
        headers.set("Accept", "*/*");
        headers.set("User-Agent", "Widevine CDM v1.0");
        headers.set("Content-length", 0);
        HttpRequest('POST', url, headers, function(evt) {//Call a function when the state changes.
          if(evt.target.readyState == 4 && evt.target.status == 200) {
              console.log(' >>>>>>>>>>>>> individualization-request OK <<<<<<<<<<<<<<');
              v.mediaKeys.setServerCertificate(evt.target.response);
          }
          else {
            console.log('individualization-request failed with status = ' + evt.target.status + " , response = " + evt.target.response);
          }
        }, null, "arraybuffer"
        );
      }
      if (msgEventType == 'license-request') {
        // Do the license acquisition process.
        if (KEYSYSTEM_TYPE == "org.w3.clearkey") {
          var msg = JSON.parse(msgStr);

          Log(token, "got message from CDM: " + msgStr);
          Log("MediaKeyMessageType= ", msgEventType);
          //is(msg.type, sessionType, TimeStamp(token) + " key session type should match");
          //ok(msg.kids, TimeStamp(token) + " message event should contain key ID array");

          var outKeys = [];

          for (var i = 0; i < msg.kids.length; i++) {
            //var id64 = msg.kids[i];
            //
            var idHex = Base64ToHex(msg.kids[i]).toLowerCase();
           // msg.kids[i] = window.btoa(msg.kids[i].substring(0, 16)).replace(/=/g, "");
            var id64 = msg.kids[i];
            id64 = id64.replace(/-/g, "+");
            Log(token, " window.btoa " + msg.kids[i]);
            //var idHex = Base64ToHex(msg.kids[i]).toLowerCase();
            //
            //test.keys[idHex] = window.btoa(test.keys[idHex]).replace(/=/g, "");
            var key = test.keys[idHex];

            if (key) {
              Log(token, "found key " + key + " for key id " + idHex);
              //Log("id64 = " + id64.toString('base64').replace(/=/g, "") + " HexToBase64(key) = "+ HexToBase64(key).toString('base64').replace(/=/g, ""));
              outKeys.push({
                "kty":"oct",
                "alg":"A128KW",
                "kid":id64,
                "k":HexToBase64(key).replace(/-/g, "+")
              });
            } else {
              bail(token + " couldn't find key for key id " + idHex);
            }
          }

          var update = JSON.stringify({
            "keys" : outKeys,
            "type" : msg.type
          });
          Log(token, "sending update message to CDM: " + update);

          ev.target.update(StringToArrayBuffer(update)).then(function() {
            Log(token, "MediaKeySession update ok!");
            resolve(ev.target);
          }).catch(function(reason) {
            bail(token + " MediaKeySession update failed")(reason);
            reject();
          });
        } //if clearkey
        if (KEYSYSTEM_TYPE == "com.alpha.widevine") {
          debugger;
          // For Testing
          var hexstring = "080112f90c0aa80c080112eb090aae02080212107282beb1e390ddbd0db93d29c919585a18aa8fd1b505228e023082010a0282010100c8c97544d4092980d91495c09b61c21f37118d20145fb8763eab998ffba1cb1b839b892fe68ee94c4c7114335abf29696104fe0c024e09d9233c299405390b6623260a3edfc8e28073fdb313697cef7d878c6e121b852c62f51a127d91c7c7ebd62c5a783dc226111bacd2098c78d0be5625741cd9f3b2cb953df5b63eea6a1c4e725cff63b55a79ccc55a350d52195335d06b808431d7553fc8d95a5dc74e3df66b79848064eae28f9eb05606f1c74a6b684cd5ba1f16c90153d78399baacdc12d422686c01aa4c267503b402731fd0a5fd13928ba7fa148b5ab43c696f431e75645eb6ce379188df932c48009c1bf06b7e2fa41a34e0a9d5b2217af896c7d7020301000128dd22128002678fdb700ae7feceb58ae1addde81b248940686c66b6221b3f67555aad94030c6045cebc8f33e2dfedca8d04bd1d53e8995f85022175b2e2334c79dffee3834124a76f9e51fdb996bc69f7e0f5d9ff814fb4a80288327f92ac2b27b58f2ac902bc520e2baa6f987f8bd78e10be255a8b679791cce8218c773979e94dd1ae545a6cc225bc97593f9de1c115f3d4906cd777d28902bd705ac37ce2401e77cb5a45b338d455417acc8899eacd392ddc6a7c642fe086f9c458b9f64b6c5ba5c95e8df8bbdc4d614f93dfc8e31d069ed43b7dd5ed64dc1ee801c714cfdaf5961a411031955f182b050a0a33f2a11452b3ba0cc982d8aefd7a66517d33205b8a8cafb41ab4050aae020801121017dcbc27d11341d497135442a188daa6188f89809105228e023082010a0282010100d21add7549d2748b3494526a9c3fb86c79376bbe8c8856f601b8d10461f77acc7331b10debf365120056cdb5662d25907b74f12382f0f4a0ca475eea9562815c6228f6f698ada27879d8890f2a2d96a746ddef5316301c003519c2a2250354674169fdda41ce14d3c52bea7a20384515012d5952b38aa19e15e8563cc7aaa81c2122880aa370a64fea23c53fb83ac3db5753214730a349e07f64bf32be7ead30d02612af110bb44fb08e1d308173b327ef64d40c41639542b2d1a73c98a6607ec6c683b513a58470514106ef87ae1e7b9c695b93a104df7437bfc4167789748a43ed208f2c1fa710793c688885eae732a8bfdf5b423b23d75b88fc0adc8fbdb5020301000128dd2212800372d2fb88098ba3b85b6b4354e03767dbe2d7724663fb0a62abf7704ea910e01f221349ee16d0152c769384050ce78520668c06ccfd3d789af3eb69ff163615cd609169fdbe2e15a029d34ad2605625bc81844c9d1e2ce0519039f3799adaef86641e20b033dc16df2e5b9a1a2a417b8bb3b7a4d9ad1a99367448587da13dde05a3ed9d62fa42078973b4aa40263d7bfa23f1072e94cdf323fa45f78408823e55c4f4c5c723819cf44ce6d98e50c04ec24d93b1aab8877b9108b9ca391308e1a3645ebb0e7cacbb40b5451560ed799421873bfb5abb917fa60db9c77cb8606af7e3142626f5ea40e5cb8aa089d8e7d6a9361935c426a4450ea8bc2e57290d3bf0a0962991d2a91b752fc80c3e7e4e55033d71c94b325307a68815f026448f56a2741cebefc18e8c142f5f62bfaa67a291517dde982d8cd5a9df6e3d3a99b806f6d60991358c5be77117d4f3168f3348e9a048539f892f4d783152c7a8095224aa56b78c5cf7bd1ab1b179c0c0d11e3c3bac84c141a00191321e3acc17242e683c1a130a0c636f6d70616e795f6e616d6512034c47451a200a0a6d6f64656c5f6e616d651212414f5350206f6e2048616d6d6572486561641a200a116172636869746563747572655f6e616d65120b61726d656162692d7637611a190a0b6465766963655f6e616d65120a68616d6d6572686561641a1f0a0c70726f647563745f6e616d65120f66756c6c5f68616d6d6572686561641a570a0a6275696c645f696e666f1249416e64726f69642f66756c6c5f68616d6d6572686561642f68616d6d6572686561643a352e312f4c4d593437442f6a616d657331323237303735363a656e672f746573742d6b6579731a2d0a096465766963655f69641220586f64655646754b455249445070716275767848646d6b6c6c477656475053001a110a0a6f735f76657273696f6e1203352e313206100120002809123c0a3a0a14080112107b1328eb61b554e293f75b1e3e94cc3b10011a203845434133383645364430333041413630313030303030303030303030303030180120c6a695b605301538a38ffff8051a80025cbf0c05866e86b907505ad5b85fa6476747f8dc2ef213209349a847aa5aa2b95f94f90d51ec5be1a930f835a12708158766a4806594e684c60d9323b77b9720ead56572014fa585f3b39e54026a63fb30c707e2b79ce52a06ca4c81003368cf20fd98660210422ed3a1d5895f416cf4418ae1f4ad4a510bb9beca8b29ae2afbe2e5f8dc067d8b00922979701468b14d0187aec49af32cbc02f2ef4de397f5c92fe971f76579780274e2eb11ad7f78ea80cd438dc63dff0445a4d792aba9bc91fa3b14bdbaa468666652ae77c4417b8c38d00a5fee265db6f4954fc407759751fc79a1c1072a2aa071a2ffbffe9b2fbba6e73e0685683b3b7a211e8aa4a76a59";
          var hexdata = ''
          for (var i=0; i<hexstring.length; i+=2) {
            var tmp = hexstring[i] + hexstring[i+1];
            hexdata += String.fromCharCode(parseInt(tmp, 16));
          }
          var body = StringToArrayBuffer(hexdata);
          // Normal scenario
          //var body = ev.message;
          console.log("do widevine license request");
          var licenseUrl = "https://dash-mse-test.appspot.com/api/drm/widevine?drm_system=widevine&source=YOUTUBE&video_id=03681262dc412c06&ip=0.0.0.0&ipbits=0&expire=19000000000&sparams=ip,ipbits,expire,source,video_id,drm_system&signature=289105AFC9747471DB0D2A998544CC1DAF75B8F9.18DE89BB7C1CE9B68533315D0F84DF86387C6BB3&key=test_key1";
          HttpRequest('POST', licenseUrl, null, function(evt) {//Call a function when the state changes.
            if(evt.target.readyState == 4 && evt.target.status == 200) {
              console.log('!!!!!!!!!!!!!icense-request OK');
              console.log(evt.target.response);
              var SOAPbody = ArrayBufferToString(new Uint8Array(this.response)).split('\r\n').pop();
              var license = StringToArrayBuffer(SOAPbody);
              alert(SOAPbody);
              ev.target.update(license).then(function() {
                Log(token, "Widevine MediaKeySession update ok!");
                resolve(ev.target);
              }).catch(function(reason) {
                bail(token + "Widevine MediaKeySession update failed")(reason);
                reject();
              });
            }
            else {
              console.log('license-request failed with status = ' + evt.target.status + " , response = " + evt.target.response);
            }
          }//callback
          , body, "arraybuffer");

        }
      }
    });

      Log(token, "session[" + session.sessionId + "].generateRequest(" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + ")");
      session.generateRequest(ev.initDataType, ev.initData).catch(function(reason) {
        // Reject the promise if generateRequest() failed. Otherwise it will
        // be resolve in UpdateSessionFunc().
        bail(token + ": session[" + session.sessionId + "].generateRequest(" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + ") failed")(reason);
        reject();
      });
    })

    .then(function(aSession) {
      Log(token, "session[" + session.sessionId + "].generateRequest(" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + ") succeeded");
      if (params && params.onsessionupdated) {
        params.onsessionupdated(aSession);
      }
      processInitDataQueue();
    });
  }

  function streamType(type) {
    var x = test.tracks.find(o => o.name == type);
    return x ? x.type : undefined;
  }

  // All 'initDataType's should be the same.
  // null indicates no 'encrypted' event received yet.
  var initDataType = null;
  v.addEventListener("encrypted", function(ev) {
    info("KEYSYSTEM_TYPE========@@=============" + KEYSYSTEM_TYPE);
    if (initDataType === null) {
      Log(token, "got first encrypted(" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + "), setup session");
      initDataType = ev.initDataType;
      initDataQueue.push(ev);

      function chain(promise, onReject) {
        return promise.then(function(value) {
          return Promise.resolve(value);
        }).catch(function(reason) {
          onReject(reason);
          return Promise.reject();
        })
      }

      var options = [
         {
           initDataType: ev.initDataType,
           videoType: streamType("video"),
           audioType: streamType("audio"),
         }
       ];
      var p = navigator.requestMediaKeySystemAccess(KEYSYSTEM_TYPE, options);
      var r = bail(token + " Failed to request key system access.");
      chain(p, r)
      .then(function(keySystemAccess) {
        var p = keySystemAccess.createMediaKeys();
        var r = bail(token +  " Failed to create MediaKeys object");
        return chain(p, r);
      })

      .then(function(mediaKeys) {
        Log(token, "created MediaKeys object ok");
        mediaKeys.sessions = [];
        var p = v.setMediaKeys(mediaKeys);
        return chain(p, onSetKeysFail);
      })

      .then(function() {
        Log(token, "set MediaKeys on <video> element ok");
        processInitDataQueue();
      })
    } else {
      if (ev.initDataType !== initDataType) {
        return bail(token + ": encrypted(" + ev.initDataType + ", " +
                    StringToHex(ArrayBufferToString(ev.initData)) + ")")
                   ("expected " + initDataType);
      }
      if (initDataQueue !== null) {
        Log(token, "got encrypted(" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + ") event, queue it for later session update");
        initDataQueue.push(ev);
      } else {
        Log(token, "got encrypted(" + ev.initDataType + ", " + StringToHex(ArrayBufferToString(ev.initData)) + ") event, update session now");
        initDataQueue = [ev];
        processInitDataQueue();
      }
    }
  });
  return v;
}

function SetupEMEPref(callback) {
  var prefs = [
    [ "media.mediasource.enabled", true ],
    [ "media.eme.apiVisible", true ],
  ];

  // if (SpecialPowers.Services.appinfo.name == "B2G" ||
  //     !manifestVideo().canPlayType("video/mp4")) {
  //   // XXX remove once we have mp4 PlatformDecoderModules on all platforms.
  //   prefs.push([ "media.use-blank-decoder", true ]);
  // }

  // SpecialPowers.pushPrefEnv({ "set" : prefs }, callback);
}

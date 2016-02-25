// In each list of tests below, test file types that are not supported should
// be ignored. To make sure tests respect that, we include a file of type
// "bogus/duh" in each list.

// Make sure to not touch navigator in here, since we want to push prefs that
// will affect the APIs it exposes, but the set of exposed APIs is determined
// when Navigator.prototype is created.  So if we touch navigator before pushing
// the prefs, the APIs it exposes will not take those prefs into account.  We
// work around this by using a navigator object from a different global for our
// UA string testing.
var gManifestNavigatorSource = document.documentElement.appendChild(document.createElement("iframe"));
gManifestNavigatorSource.style.display = "none";
function manifestNavigator() {
  return gManifestNavigatorSource.contentWindow.navigator;
}

// Similarly, use a <video> element from a different global for canPlayType or
// other feature testing.  If we used one from our global and did so before our
// prefs are pushed, then we'd instantiate HTMLMediaElement.prototype before the
// prefs are pushed and APIs we expect to be on that object would not be there.
function manifestVideo() {
  return gManifestNavigatorSource.contentDocument.createElement('video');
}


// Used by test_mozLoadFrom.  Need one test file per decoder backend, plus
// anything for testing clone-specific bugs.
var cloneKey = Math.floor(Math.random()*100000000);
// var gCloneTests = gSmallTests.concat([
//   { name:"bug520908.ogv", type:"video/ogg", duration:0.2 },
//   // short-video is more like 1s, so if you load this twice you'll get an unexpected duration
//   { name:"dynamic_resource.sjs?key=" + cloneKey + "&res1=320x240.ogv&res2=short-video.ogv",
//     type:"video/ogg", duration:0.266 },
// ]);




// Returns true if two TimeRanges are equal, false otherwise
function range_equals(r1, r2) {
  if (r1.length != r2.length) {
    return false;
  }
  for (var i = 0; i < r1.length; i++) {
    if (r1.start(i) != r2.start(i) || r1.end(i) != r2.end(i)) {
      return false;
    }
  }
  return true;
}

function IsWindows8OrLater() {
  var re = /Windows NT (\d.\d)/;
  var winver = manifestNavigator().userAgent.match(re);
  return winver && winver.length == 2 && parseFloat(winver[1]) >= 6.2;
}



// Test files for Encrypted Media Extensions
var gEMETests = [
  {
    name:"audio&video tracks, both with all keys",
    tracks: [
      {
        name:"audio",
        type:"audio/mp4; codecs=\"mp4a.40.2\"",
        fragments:[ "oopsa.mp4",
                  ],
      },
      {
        name:"video",
        type:"video/mp4; codecs=\"avc1.4d4015\"",
        fragments:[ "oopsv.mp4",
                  ],
      },
    ],
    keys: {
      // "keyid" : "key"
      "7e571d037e571d037e571d037e571d03" : "7e5733337e5733337e5733337e573333",
      "7e571d047e571d047e571d047e571d04" : "7e5744447e5744447e5744447e574444",
    },
    sessionType:"temporary",
    sessionCount:2,
    duration:1.60,
  },
];



function checkMetadata(msg, e, test) {
  // if (test.width) {
  //   is(e.videoWidth, test.width, msg + " video width");
  // }
  // if (test.height) {
  //   is(e.videoHeight, test.height, msg + " video height");
  // }
  // if (test.duration) {
  //   ok(Math.abs(e.duration - test.duration) < 0.1,
  //      msg + " duration (" + e.duration + ") should be around " + test.duration);
  // }
  // is(!!test.keys, SpecialPowers.do_lookupGetter(e, "isEncrypted").apply(e),
  //    msg + " isEncrypted should be true if we have decryption keys");
}

// Returns the first test from candidates array which we can play with the
// installed video backends.
function getPlayableVideo(candidates) {
  var resources = getPlayableVideos(candidates);
  if (resources.length > 0)
    return resources[0];
  return null;
}

function getPlayableVideos(candidates) {
  var v = document.createElement("video");
  return candidates.filter(function(x){return /^video/.test(x.type) && v.canPlayType(x.type);});
}

function getPlayableAudio(candidates) {
  var v = document.createElement("audio");
  var resources = candidates.filter(function(x){return /^audio/.test(x.type) && v.canPlayType(x.type);});
  if (resources.length > 0)
    return resources[0];
  return null;
}

// Returns the type of element that should be created for the given mimetype.
function getMajorMimeType(mimetype) {
  if (/^video/.test(mimetype)) {
    return "video";
  } else {
    return "audio";
  }
}

// Force releasing decoder to avoid timeout in waiting for decoding resource.
function removeNodeAndSource(n) {
  n.remove();
  // Clearing srcObject and/or src will actually set them to some default
  // URI that will fail to load, so make sure we don't produce a spurious
  // bailing error.
  n.onerror = null;
  // reset |srcObject| first since it takes precedence over |src|.
  n.srcObject = null;
  n.src = "";
  while (n.firstChild) {
    n.removeChild(n.firstChild);
  }
}

function once(target, name, cb) {
  var p = new Promise(function(resolve, reject) {
    target.addEventListener(name, function() {
      target.removeEventListener(name, cb);
      resolve();
    });
  });
  if (cb) {
    p.then(cb);
  }
  return p;
}

function TimeStamp(token) {
  function pad(x) {
    return (x < 10) ? "0" + x : x;
  }
  var now = new Date();
  var ms = now.getMilliseconds();
  var time = "[" +
             pad(now.getHours()) + ":" +
             pad(now.getMinutes()) + ":" +
             pad(now.getSeconds()) + "." +
             ms +
             "]" +
             (ms < 10 ? "  " : (ms < 100 ? " " : ""));
  return token ? (time + " " + token) : time;
}

function Log(token, msg) {
  info(TimeStamp(token) + " " + msg);
}

// Number of tests to run in parallel.
var PARALLEL_TESTS = 2;

// Prefs to set before running tests.  Use this to improve coverage of
// conditions that might not otherwise be encountered on the test data.
var gTestPrefs = [
  ['media.recorder.max_memory', 1024],
  ["media.preload.default", 2], // default preload = metadata
  ["media.preload.auto", 3] // auto preload = enough
];

// When true, we'll loop forever on whatever test we run. Use this to debug
// intermittent test failures.
const DEBUG_TEST_LOOP_FOREVER = false;

// Manages a run of media tests. Runs them in chunks in order to limit
// the number of media elements/threads running in parallel. This limits peak
// memory use, particularly on Linux x86 where thread stacks use 10MB of
// virtual address space.
// Usage:
//   1. Create a new MediaTestManager object.
//   2. Create a test startTest function. This takes a test object and a token,
//      and performs anything necessary to start the test. The test object is an
//      element in one of the g*Tests above. Your startTest function must call
//      MediaTestManager.start(token) if it starts a test. The test object is
//      guaranteed to be playable by our supported decoders; you don't need to
//      check canPlayType.
//   3. When your tests finishes, call MediaTestManager.finished(), passing
//      the token back to the manager. The manager may either start the next run
//      or end the mochitest if all the tests are done.
function MediaTestManager() {

  // Sets up a MediaTestManager to runs through the 'tests' array, which needs
  // to be one of, or have the same fields as, the g*Test arrays of tests. Uses
  // the user supplied 'startTest' function to initialize the test. This
  // function must accept two arguments, the test entry from the 'tests' array,
  // and a token. Call MediaTestManager.started(token) if you start the test,
  // and MediaTestManager.finished(token) when the test finishes. You don't have
  // to start every test, but if you call started() you *must* call finish()
  // else you'll timeout.
  this.runTests = function(tests, startTest) {
    this.startTime = new Date();
    //SimpleTest.info("Started " + this.startTime + " (" + this.startTime.getTime()/1000 + "s)");
    this.testNum = 0;
    this.tests = tests;
    this.startTest = startTest;
    this.tokens = [];
    this.isShutdown = false;
    this.numTestsRunning = 0;
    this.handlers = {};

    this.nextTest();
    // Always wait for explicit finish.
    // SimpleTest.waitForExplicitFinish();
    // SpecialPowers.pushPrefEnv({'set': gTestPrefs}, (function() {
    //   this.nextTest();
    // }).bind(this));

    // SimpleTest.registerCleanupFunction(function() {
    //   if (this.tokens.length > 0) {
    //     info("Test timed out. Remaining tests=" + this.tokens);
    //   }
    //   for (var token of this.tokens) {
    //     var handler = this.handlers[token];
    //     if (handler && handler.ontimeout) {
    //       handler.ontimeout();
    //     }
    //   }
    // }.bind(this));
  }

  // Registers that the test corresponding to 'token' has been started.
  // Don't call more than once per token.
  this.started = function(token, handler) {
    this.tokens.push(token);
    this.numTestsRunning++;
    this.handlers[token] = handler;
    // is(this.numTestsRunning, this.tokens.length, "[started " + token + "] Length of array should match number of running tests");
  }

  // Registers that the test corresponding to 'token' has finished. Call when
  // you've finished your test. If all tests are complete this will finish the
  // run, otherwise it may start up the next run. It's ok to call multiple times
  // per token.
  this.finished = function(token) {
    var i = this.tokens.indexOf(token);
    if (i != -1) {
      // Remove the element from the list of running tests.
      this.tokens.splice(i, 1);
    }

    info("[finished " + token + "] remaining= " + this.tokens);
    this.numTestsRunning--;
    //is(this.numTestsRunning, this.tokens.length, "[finished " + token + "] Length of array should match number of running tests");
    if (this.tokens.length < PARALLEL_TESTS) {
      this.nextTest();
    }
  }

  // Starts the next batch of tests, or finishes if they're all done.
  // Don't call this directly, call finished(token) when you're done.
  this.nextTest = function() {
    while (this.testNum < this.tests.length && this.tokens.length < PARALLEL_TESTS) {
      var test = this.tests[this.testNum];
      var token = (test.name ? (test.name + "-"): "") + this.testNum;
      this.testNum++;

      if (DEBUG_TEST_LOOP_FOREVER && this.testNum == this.tests.length) {
        this.testNum = 0;
      }

      var element = document.createElement('video');
      element.defaultMuted = true;
      // Ensure we can play the resource type.
      if (test.type && !element.canPlayType(test.type))
        continue;

      // Do the init. This should start the test.
      this.startTest(test, token);
    }

    if (this.testNum == this.tests.length &&
        !DEBUG_TEST_LOOP_FOREVER &&
        this.tokens.length == 0 &&
        !this.isShutdown)
    {
      this.isShutdown = true;
      if (this.onFinished) {
        this.onFinished();
      }
      var onCleanup = function() {
        var end = new Date();
        // SimpleTest.info("Finished at " + end + " (" + (end.getTime() / 1000) + "s)");
        // SimpleTest.info("Running time: " + (end.getTime() - this.startTime.getTime())/1000 + "s");
        // SimpleTest.finish();
      }.bind(this);
      mediaTestCleanup(onCleanup);
      return;
    }
  }
}

// Ensures we've got no active video or audio elements in the document, and
// forces a GC to release the address space reserved by the decoders' threads'
// stacks.
function mediaTestCleanup(callback) {
    var V = document.getElementsByTagName("video");
    for (i=0; i<V.length; i++) {
      removeNodeAndSource(V[i]);
      V[i] = null;
    }
    var A = document.getElementsByTagName("audio");
    for (i=0; i<A.length; i++) {
      removeNodeAndSource(A[i]);
      A[i] = null;
    }
    //SpecialPowers.exactGC(window, callback);
}

function setMediaTestsPrefs(callback, extraPrefs) {
  var prefs = gTestPrefs;
  if (extraPrefs) {
    prefs = prefs.concat(extraPrefs);
  }
  SpecialPowers.pushPrefEnv({"set": prefs}, callback);
}

// B2G emulator and Android 2.3 are condidered slow platforms
function isSlowPlatform() {
  return SpecialPowers.Services.appinfo.name == "B2G" || getAndroidVersion() == 10;
}

//SimpleTest.requestFlakyTimeout("untriaged");

var colors = require('colors');

// Check for command line argument specifying config profile
if ( typeof process.argv[2] == 'undefined' ) {
    console.log("Usage: node replay.js <config-key>");
    process.exit(1);
}

// Load the specified configuration profile
try {
    var konphyg = require('konphyg')(__dirname + '/config');
    var config = konphyg(process.argv[2]);

    if (!config.source) throw "Invalid config file: missing 'source'";
    if (!config.speedupFactor) throw "Invalid config file: missing 'speedupFactor'";
    if (config.startOutputEnabled == undefined) throw "Invalid config file: missing 'startOutputEnabled'";
    if (!config.target) throw "Invalid config file: missing 'target'";
    else {
      if (!config.target.host) throw "Invalid config file: missing 'target.host'";
      if (!config.target.port) throw "Invalid config file: missing 'target.port'";
    }

} catch (e) {
    console.log(e + "\n");
    console.log("Usage: node replay.js <config-key>");
    process.exit(1);
}

process.stdin.resume(); 
process.stdin.setEncoding('utf8'); 
process.stdin.setRawMode(true); 
process.stdin.on('data', function(char) { 
  if (char == '\3') { 
    console.log('\nExiting on Ctrl-C...'); 
    process.exit(); 
  } else if (char == 'q') { 
    console.log('\nExiting on q...'); 
    process.exit(); 
  } else if (char === 'e') {
        if (logAllResponses === 1) {
           console.log('\nActivating non-200s logging only.'); 
           logAllResponses = 0;
        } else {
           console.log('\nActivating all logging.'); 
           logAllResponses = 1;        
        }
  } else if (char === 'o') { 
        if (outputToggle === false) {
           console.log('\nActivating response data output.'); 
           outputToggle = true;
        } else {
           console.log('\nDisabling response data output.'); 
           outputToggle = false;        
        }
  } else { 
    process.stdout.write(char); 
  } 
}); 

// Require the necessary modules
var http = config.target.port == '443' ? require('https') : require('http');
var Lazy = require('lazy');
var spawn = require('child_process').spawn;
var logfile = spawn('cat', [config.source]);

// Set up some variables
var regexLogLine = /^[0-9a-f.:]+ - - \[([0-9]{2}\/[a-z]{3}\/[0-9]{4}):([0-9]{2}:[0-9]{2}:[0-9]{2}[^\]]*)\] \"([^\"]+)\" [0-9]+ [0-9]+/i;
var regexHttpRequest = /^(GET|POST) (.+) HTTP\/(1.[0-1])$/i;
var dtStart = Date.now();
var dtDuration = 0;
var outputToggle = config.startOutputEnabled || false;
var logAllResponses = 1;

console.log('Loading access log...');

// Initiate ze process! 
Lazy(logfile.stdout)
    .lines
    .map(String)
    .map(function (line) {
        // Chop the line
        var parts = regexLogLine.exec(line);
        if ( parts != null ) { 
            var recDate = Date.parse(new Date(parts[1]+' '+parts[2]));

            // Determine the earliest datetime covered by log
            if (recDate < dtStart ) {
                dtStart = recDate;
            }

            // Process the HTTP request portion
            var httpRec = regexHttpRequest.exec(parts[3]);
            if ( httpRec != null ) {
                return {
                    datetime: recDate,
                    method: httpRec[1],
                    http: httpRec[3],
                    uri: httpRec[2]
                };
            }
        } 
    }).filter(function(item){
        // Filter out any invalid records
        return ( typeof item != 'undefined' )
    }).join(function(f) {
        console.log('Determining execution order and offset...');

        // Compile a requestSet array which holds the requests in the correct order
        var requestSet = new Array();
        f.forEach(function(item) {
            // Calculate # of seconds past start we should fire request
            var offset = Math.round(((item.datetime - dtStart) / 1000) / config.speedupFactor);
            if (offset > dtDuration) dtDuration = offset;

            if ( typeof requestSet[offset] == 'undefined' ) {
                requestSet[offset] = new Array();
            }
            requestSet[offset].push(item);
        });

        console.log("Executing...\n\n");

        var reqSeq = 0;
        var reqTimings = new Array();        
        var reqData = new Array();
        var reqResponse = new Array();
        var reqUri = new Array();
        var reqServer = new Array();

        // RUN ZE TEST!
        var execStart = Date.now();
        var interval = setInterval(function() {

            // Determine how much time has passed
            var runOffsetMS = (Date.now() - execStart);
            var runOffset = Math.round(runOffsetMS / 1000);

            // Is the test over yet?  How about now? now?
            if ( runOffset > dtDuration ) {
                clearInterval(interval);
            }

            // Have we got some requests to fire?
            if ( typeof requestSet[runOffset] != 'undefined' ) {
                // FIRE ZE MISSILES!!...er, requests, I mean
                requestSet[runOffset].forEach(function(item){
                    var reqNum = reqSeq++;
                    reqUri[reqNum] = item.uri;
                    var req = http.request({
                            host: config.target.host,
                            port: config.target.port,
                            path: item.uri,
                            method: item.method,
                            reqStart: new Date().getTime(),
                            agent: false
                        }, 
                        function(resp) {}
                    )
                    .on('socket', function() { reqTimings[reqNum] = new Date().getTime(); })
                    .on('error', function() { console.log('an error has occured!'.red); })
                    .on('response', function(response) {
                        var diff = (new Date().getTime()) - reqTimings[reqNum];
                        reqResponse[reqNum] = response.statusCode 
                        reqServer[reqNum] = response.headers['x-b-srvr'] || 'n/a';
                        response.on('data', function(chunk) {
                            var data = reqData[reqNum]||'';
                            data += chunk;
                            reqData[reqNum] = data;
                        });
                        response.on('end', function() {
                            var requestTimingDiff = (new Date().getTime()) - reqTimings[reqNum];
                            var response = reqResponse[reqNum];
                            var responseString;
                            if (response !== 200) {
                                responseString = new String(reqResponse[reqNum]).red;
                            } else {
                                responseString = new String(reqResponse[reqNum]).blue;
                            }
                            
                            if (logAllResponses || response !== 200) {
                                console.log(new String(reqNum).grey + ' ' + 
                                            responseString + ' ' +
                                            new String(reqServer[reqNum]).grey + ' ' +
                                            requestTimingDiff + ' ' + 
                                            new String(reqUri[reqNum]).cyan);
                                // enable to be able to spot check responses for each request
                                if (outputToggle) {
                                    console.log("|"+new String(reqData[reqNum]).yellow+"|");
                                }                                                        
                            }        
                        });
                    });
                    req.end();
                });

                // Discard the request info so we don't process it again
                delete requestSet[runOffset];
            }
        }, 100);
    });

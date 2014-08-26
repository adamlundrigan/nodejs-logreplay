
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

console.log('Playing ' + config.source + ' against ' +  config.target.host + ':' + config.target.port);

// Require the necessary modules
var http = config.target.port == '443' ? require('https') : require('http');
var Lazy = require('lazy');
var spawn = require('child_process').spawn;
var logfile = spawn('cat', [config.source]);

// Set up some variables
var regexLogLine = /^[0-9a-f.:]+ - ([^ ]+) \[([0-9]{2}\/[a-z]{3}\/[0-9]{4}):([0-9]{2}:[0-9]{2}:[0-9]{2}[^\]]*)\] \"([^\"]+)\" [0-9]+ [0-9]+/i;
var regexHttpRequest = /^(GET|POST) (.+) HTTP\/(1.[0-1])$/i;
var dtStart = Date.now();
var dtDuration = 0;

console.log('Loading access log...');

// Initiate ze process! 
Lazy(logfile.stdout)
    .lines
    .map(String)
    .map(function (line) {
        // Chop the line
        var parts = regexLogLine.exec(line);
        if ( parts != null ) { 
            var recDate = Date.parse(new Date(parts[2]+' '+parts[3]));

            // Determine the earliest datetime covered by log
            if (recDate < dtStart ) {
                dtStart = recDate;
            }

            // Process the HTTP request portion
            var httpRec = regexHttpRequest.exec(parts[4]);
            if ( httpRec != null ) {
                return {
                    datetime: recDate,
                    method: httpRec[1],
                    http: httpRec[3],
                    uri: httpRec[2],
                    username: parts[1] != '-' ? parts[1] : (!config.anonymousUser ? null : config.anonymousUser)
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

        var timings = new Array();
        var reqSeq = 0;


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
                console.log('['+new Date(dtStart + runOffsetMS)+'] '+requestSet[runOffset].length+' Requests' );

                // FIRE ZE MISSILES!!...er, requests, I mean
                requestSet[runOffset].forEach(function(item){
                    var reqNum = reqSeq++;
                    var toString = reqNum + ': ' + (item.username == null ? '' : (item.username + '@')) + item.uri;
                    console.log(toString);
                    var req = http.request({
                            host: config.target.host,
                            port: config.target.port,
                            path: item.uri,
                            method: item.method,
                            reqStart: new Date().getTime(),
                            agent: false,
                            auth: item.username == null ? null : (item.username + ':')
                        }, 
                        function(resp) {}
                    )
                    .on('socket', function() { timings[reqNum] = new Date().getTime(); })
                    .on('error', function(e) { console.log(toString + ': ' + e.message); })
                    .on('response', function(resp) {
                        var diff = (new Date().getTime()) - timings[reqNum];
                        console.log(toString + ' [DT=' + diff + 'ms, R=' + resp.statusCode + ']'); }
                    );
                    req.end();
                });

                // Discard the request info so we don't process it again
                delete requestSet[runOffset];
            }

        }, 100);

    });

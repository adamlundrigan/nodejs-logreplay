# nodejs-logreplay #

## What?

__nodejs-logreplay__ is a (very) simple Node.js application which parses the standard Apache access log and replays the requests, in real time, against a target server.  

## Why?

__nodejs-logreplay__ was developed to assist in load testing web server(s) with the same request pattern that production systems are experiencing.  This helps us determine how code modifications will perform in production before they are deployed. 

## How?

Easy:

1. Install Node.js and the following packages from npm:
 * lazy
 * konphyg

2. Clone this repository onto the server you wish to launch your load test requests from

3. Copy the provided configuration file `config/example.json.dist` to `config/<something>.json` and edit
 * `source`: Full path to the access log you want to replay
 * `speedupFactor`: Speed at which log is replayed (ie: 2 = twice normal speed) 
 * `target`: Specifies the target of the load testing
 * * `host`: hostname of target machine
 * * `port`: target port (for SSL, only 443 is supported)

4. Run the profile you created (the <something> you chose in #3)

       `node replay.js <something>`


﻿"use strict";
require('../libs.js');

function showWatermark() {
    let text_1 = "JustEmuTarkov " + constants.serverVersion();
    let text_2 = "https://justemutarkov.github.io/";
    let diffrence = Math.abs(text_1.length - text_2.length);
    let whichIsLonger = ((text_1.length >= text_2.length) ? text_1.length : text_2.length);
    let box_spacing_between_1 = "";
    let box_spacing_between_2 = "";
    let box_width = "";

    if (text_1.length >= text_2.length) {
        for (let i = 0; i < diffrence; i++) {
            box_spacing_between_2 += " ";
        }
    } else {
        for (let i = 0; i < diffrence; i++) {
            box_spacing_between_1 += " ";
        }
    }

    for (let i = 0; i < whichIsLonger; i++) {
        box_width += "═";
    }

    logger.logRequest("╔═" + box_width + "═╗");
    logger.logRequest("║ " + text_1 + box_spacing_between_1 + " ║");
    logger.logRequest("║ " + text_2 + box_spacing_between_2 + " ║");
    logger.logRequest("╚═" + box_width + "═╝");
}

function getCookies(req) {
    let found = {};
    let cookies = req.headers.cookie;

    if (cookies) {
        for (let cookie of cookies.split(';')) {
            let parts = cookie.split('=');

            found[parts.shift().trim()] = decodeURI(parts.join('='));
        }
    }

    return found;
}

async function notificationWaitAsync(resp, sessionID) {
    let promise = new Promise(resolve => {
        setInterval(function() {
            if (notifier_f.notifierService.hasMessagesInQueue(sessionID)) {
                resolve();
            }
        }, 300);
    });
    await promise;

    let data = [];
    while (notifier_f.notifierService.hasMessagesInQueue(sessionID)) {
        let message = notifier_f.notifierService.popMessageFromQueue(sessionID);
        data.push(JSON.stringify(message));
    }
    header_f.sendTextJson(resp, data.join('\n'));
}

function sendResponse(req, resp, body, sessionID) {
    let output = "";

    // get response
    if (req.method === "POST") {
        output = response.getResponse(req, body, sessionID);
    } else {
        output = response.getResponse(req, "{}", sessionID);
    }

    if (output === "NOTIFY") {
        let splittedUrl = req.url.split('/');
        const sessionID = splittedUrl[splittedUrl.length - 1].split("?last_id")[0];

        // If we don't have anything to send, it's ok to not send anything back
        // because notification requests are long-polling. In fact, we SHOULD wait
        // until we actually have something to send because otherwise we'd spam the client
        // and the client would abort the connection due to spam.
        notificationWaitAsync(resp, sessionID);
        return;
    }

    // prepare message to send
    if (output === "DONE") {
        return;
    }

    if (output === "IMAGE") {
        let splittedUrl = req.url.split('/');
        let filepath = "";
        let file = splittedUrl[splittedUrl.length - 1];
        let baseNode = undefined;

        file = file.replace(".jpg", "").replace(".png", "");

        // get images to look through
        if (req.url.indexOf("/quest") != -1) {
            logger.logInfo("[IMG.quests]:" + req.url);
            baseNode = filepaths.images.quest;
        } else if (req.url.indexOf("/handbook") != -1) {
            logger.logInfo("[IMG.handbook]:" + req.url);
            baseNode = filepaths.images.handbook;
        } else if (req.url.indexOf("/avatar") != -1) {
            logger.logInfo("[IMG.trader]:" + req.url);
            baseNode = filepaths.images.trader;
        } else if (req.url.indexOf("/banners") != -1) {
            logger.logInfo("[IMG.banners]:" + req.url);
            baseNode = filepaths.images.banners;
        } else {
            logger.logInfo("[IMG.hideout]:" + req.url);
            baseNode = filepaths.images.hideout;
        }

        // get image
        let keys = Object.keys(baseNode);

        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];

            if (key == file) {
                filepath = baseNode[key];
                break;
            }
        }

        if (filepath === "") {
            // throw an error here
        }

        // send image
        header_f.sendFile(resp, filepath);
        return;
    }

    if (output === "MAPCONFIG") {
        let mapname = req.url.replace("/api/location/", "");
        let RandomPreset = utility.getRandomInt(1, 6);
        let map = json.read(filepaths.maps[mapname.toLowerCase() + RandomPreset]);

        logger.logInfo("[MAP.config]: " + mapname);
        header_f.sendTextJson(resp, map);
        return;
    }

    if (req.url === "/" || req.url === "/inv") {
        header_f.sendHTML(resp, output);
        return;
    }

    header_f.sendZlibJson(resp, output, sessionID);
}

function handleRequest(req, resp) {
    let IP = req.connection.remoteAddress.replace("::ffff:", "");
    const sessionID = parseInt(getCookies(req)['PHPSESSID']);

    // request without data
    if (req.method === "GET") {
        logger.logRequest("[" + sessionID + "][" + IP + "] " + req.url);
        sendResponse(req, resp, null, sessionID);
    }

    // request with data
    if (req.method === "POST") {
        req.on('data', function (data) {
            zlib.inflate(data, function (err, body) {
                let jsonData = ((body !== null && body != "" && body != "{}") ? body.toString() : "{}");

                logger.logRequest("[" + sessionID + "][" + IP + "] " + req.url + " -> " + jsonData, "cyan");
                sendResponse(req, resp, jsonData, sessionID);
            });
        });
    }
    
    // offline profile saving
    if (req.method === "PUT") {
        req.on('data', function (data) {
            // receive data
            if (req.headers.hasOwnProperty("expect")) {
                const requestLength = req.headers["content-length"] - 0;
                const sessionID = req.headers.sessionid - 0;

                if (!constants.putInBuffer(sessionID, data, requestLength)) {
                    resp.writeContinue();
                    return;
                }

                data = constants.getFromBuffer(sessionID);
            }

            // unpack data
            zlib.inflate(data, function (err, body) {
                let jsonData = json.parse((body !== undefined) ? body.toString() : "{}");

                if (!settings.gameplay.features.lootSavingEnabled) {
                    return;
                }
            
                logger.logRequest("[" + sessionID + "][" + IP + "] " + req.url + " -> " + jsonData);s
                offraid_f.saveProgress(jsonData, sessionID);
            });
        });
    }
}

function start() {
    const options = {
        cert: fs.readFileSync(filepaths.cert.server.cert),
        key: fs.readFileSync(filepaths.cert.server.key)
    };

    // set the ip
    if (settings.server.generateIp == true) {
        ip = utility.getLocalIpAddress();
        settings.server.ip = ip;
    }

    // show our watermark
    showWatermark();

    // create HTTPS server (port 443)
    let gameServer = https.createServer(options, (req, res) => {
        handleRequest(req, res);
    }).listen(443, ip, function() {
        logger.logIp("» server url: " + "https://" + ip + "/");
    });

    // server already running
    gameServer.on('error', function(e) {
        logger.logError("» Port " + 443 + " is already in use, check if the server isn't already running");
    });

    // create HTTP server (port 80)
    let launcherServer = http.createServer((req, res) => {
        handleRequest(req, res);
    }).listen(80, ip, function() {
        logger.logIp("» launcher url: " + "http://" + ip + "/");
    });

    // server already running
    launcherServer.on('error', function(e) {
        logger.logError("» Port " + 80 + " is already in use, check if the server isn't already running");
    });
}

module.exports.start = start;
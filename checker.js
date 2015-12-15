/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');
var debugLog = require('debug')('checker:log');
debugLog.log = console.log.bind(console);
var request = require('request');

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList();
    });
};

Checker.prototype.getChannelList = function() {
    "use strict";
    var serviceList = {};
    var chatList = this.gOptions.storage.chatList;
    var stateList = this.gOptions.storage.stateList;

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];
        for (var service in chatItem.serviceList) {
            var channelList = serviceList[service] = serviceList[service] || [];

            var userChannelList = chatItem.serviceList[service];
            for (var i = 0, channelName; channelName = userChannelList[i]; i++) {
                if (channelList.indexOf(channelName) !== -1) {
                    continue;
                }
                channelList.push(channelName);
            }
        }
    }

    for (service in serviceList) {
        var serviceObj = stateList[service];
        if (!serviceObj) {
            serviceObj = stateList[service] = {};
        }

        serviceList[service] = serviceList[service].map(function(channelId) {
            var channelObj = serviceObj[channelId];
            if (!channelObj) {
                channelObj = serviceObj[channelId] = {};
            }

            return base.extend({}, channelObj, {
                channelId: channelId
            });
        });
    }

    return serviceList;
};

Checker.prototype.onSendMsgError = function(err, chatId) {
    var needKick = [
        /Bot was kicked from a chat/,
        /Bad Request: wrong chat id/,
        /PEER_ID_INVALID/,
        /chat not found/
    ].some(function(re) {
        if (re.test(err)) {
            return true;
        }
    });

    if (!needKick) {
        return;
    }

    var needSave = false;
    var chatList = this.gOptions.storage.chatList;
    for (var _chatId in chatList) {
        var item = chatList[_chatId];

        if (item.chatId === chatId) {
            debug('Remove chat %s \n %j', chatId, item);
            delete chatList[_chatId];
            needSave = true;
        }
    }

    needSave && base.storage.set({chatList: chatList});
};

Checker.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var sendPic = function(chatId, request) {
        return _this.gOptions.bot.sendPhoto(chatId, request, {
            caption: text
        }).then(function (msg) {
            var fileId = msg.photo[0].file_id;

            setTimeout(function() {
                _this.track(chatId, stream, 'sendPhoto');
            });

            return fileId;
        }).catch(function(err) {
            debug('Send photo file error! %s %s \n %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);

            throw 'Send photo file error!';
        });
    };

    return new Promise(function(resolve, reject) {
        var req = request(stream.preview);
        req.on('error', function() {
            debug('Request photo error! %s \n %s', stream._channelName, stream.preview);
            return reject('Request photo error!');
        });

        return sendPic(chatId, req).then(resolve, reject);
    });
};

Checker.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;
    var chatId = null;
    var sendMsg = function(chatId) {
        return bot.sendMessage(chatId, noPhotoText, {
            disable_web_page_preview: true,
            parse_mode: 'Markdown'
        }).then(function() {
            _this.track(chatId, stream, 'sendMsg');
        }).catch(function(err) {
            debug('Send text msg error! %s %s \n %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(err) {
            debug('Send photo msg error! %s %s \n %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var send = function() {
        var hasPhoto = stream._photoId;
        var promiseList = [];

        while (chatId = chatIdList.shift()) {
            if (!hasPhoto) {
                promiseList.push(sendMsg(chatId));
            } else {
                promiseList.push(sendPic(chatId, hasPhoto));
            }
        }

        return Promise.all(promiseList);
    };

    if (!stream.preview) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    chatId = chatIdList.shift();
    return _this.getPicId(chatId, text, stream).then(function(fileId) {
        stream._photoId = fileId;
    }).catch(function(err) {
        chatIdList.unshift(chatId);
        debug('Function getPicId throw error!', err);
    }).then(function() {
        return send();
    });
};

Checker.prototype.onNewVideo = function(videoItem) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, videoItem);
    var noPhotoText = base.getNowStreamText(this.gOptions, videoItem);

    var chatList = this.gOptions.storage.chatList;

    var chatIdList = [];

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];

        var userChannelList = chatItem.serviceList && chatItem.serviceList[videoItem._service];
        if (!userChannelList) {
            continue;
        }

        if (userChannelList.indexOf(videoItem._channelName) === -1) {
            continue;
        }

        chatIdList.push(chatItem.chatId);
    }

    if (!chatIdList.length) {
        return;
    }

    return this.sendNotify(chatIdList, text, noPhotoText, videoItem);
};

Checker.prototype.notifyAll = function(videoList) {
    "use strict";
    var _this = this;

    var promiseList = [];
    videoList.forEach(function (videoItem) {
        promiseList.push(_this.onNewVideo(videoItem));
    });

    return Promise.all(promiseList);
};

Checker.prototype.updateList = function() {
    "use strict";
    var _this = this;
    var stateList = this.gOptions.storage.stateList;

    var onGetVideoList = function(videoList) {
        videoList.sort(function(a, b) {
            var aDate = new Date(a.publishedAt);
            var bDate = new Date(b.publishedAt);

            if (aDate.getTime() > bDate.getTime()) {
                return 1;
            } else {
                return -1;
            }
        });
        return _this.notifyAll(videoList);
    };

    return Promise.resolve().then(function() {
        var serviceChannelList = _this.getChannelList();
        var services = _this.gOptions.services;

        var promiseList = [];

        for (var service in serviceChannelList) {
            if (!serviceChannelList.hasOwnProperty(service)) {
                continue;
            }

            if (!services[service]) {
                debug('Service "%s" is not found!', service);
                continue;
            }

            var channelList = JSON.parse(JSON.stringify(serviceChannelList[service]));
            while (channelList.length) {
                var arr = channelList.splice(0, 100);
                var videoListPromise = (function getVideoList(service, arr, retry) {
                    return services[service].getVideoList(arr).catch(function(err) {
                        retry++;
                        if (retry >= 5) {
                            debug("Request stream list %s error! %s", service, err);
                            return [];
                        }

                        return new Promise(function(resolve) {
                            setTimeout(resolve, 5 * 1000);
                        }).then(function() {
                            debug("Retry %s request stream list %s! %s", retry, service, err);
                            return getVideoList(service, arr, retry);
                        });
                    });
                })(service, arr, 0);

                promiseList.push(videoListPromise.then(function(videoList) {
                    return onGetVideoList(videoList);
                }));
            }
        }

        return Promise.all(promiseList).then(function() {
            return base.storage.set({stateList: stateList});
        });
    });
};

Checker.prototype.track = function(chatId, stream, title) {
    "use strict";
    try {
        this.gOptions.botan.track({
            text: stream._channelName,
            from: {
                id: 1
            },
            chat: {
                id: chatId
            },
            date: parseInt(Date.now() / 1000)
        }, title);
    } catch(e) {
        debug('Botan track error %s', e.message);
    }
};

module.exports = Checker;
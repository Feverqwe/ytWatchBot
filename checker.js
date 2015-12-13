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

    return serviceList;
};

Checker.prototype.onSendMsgError = function(e, chatId) {
    var errorMsg = e && e.message || '';

    var isError = [
        'Bot was kicked from a chat',
        'Bad Request: wrong chat id',
        'PEER_ID_INVALID',
        'chat not found'
    ].some(function(desc) {
        if (errorMsg.indexOf(desc) !== -1) {
            return true;
        }
    });

    if (!isError) {
        return;
    }

    var needSave = false;
    var storage = this.gOptions.storage;
    for (var _chatId in storage.chatList) {
        var item = storage.chatList[_chatId];
        if (item.chatId === chatId) {
            debug('Remove chat %s \n %j', chatId, item);

            delete storage.chatList[_chatId];

            needSave = true;
        }
    }

    needSave && base.storage.set({chatList: storage.chatList});
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
        }).catch(function(e) {
            debug('Send photo file error! %s %s \n %s', chatId, stream._channelName, e);

            _this.onSendMsgError(e, chatId);

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
        }).catch(function(e) {
            debug('Send text msg error! %s %s \n %s', chatId, stream._channelName, e);

            _this.onSendMsgError(e, chatId);
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(e) {
            debug('Send photo msg error! %s %s \n %s', chatId, stream._channelName, e);

            _this.onSendMsgError(e, chatId);
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

Checker.prototype.onNewStream = function(stream) {
    "use strict";
    var _this = this;
    var text = base.getNowStreamPhotoText(this.gOptions, stream);
    var noPhotoText = base.getNowStreamText(this.gOptions, stream);

    var chatList = this.gOptions.storage.chatList;

    var chatIdList = [];

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];

        var userChannelList = chatItem.serviceList && chatItem.serviceList[stream._service];
        if (!userChannelList) {
            continue;
        }

        if (userChannelList.indexOf(stream._channelName) === -1) {
            continue;
        }

        chatIdList.push(chatItem.chatId);
    }

    if (!chatIdList.length) {
        return;
    }

    return this.sendNotify(chatIdList, text, noPhotoText, stream);
};

Checker.prototype.notifyAll = function(streamList) {
    "use strict";
    var _this = this;

    var promiseList = [];
    streamList.forEach(function (stream) {
        promiseList.push(_this.onNewStream(stream));
    });

    return Promise.all(promiseList);
};

Checker.prototype.updateList = function() {
    "use strict";
    var _this = this;
    var lastStreamList = this.gOptions.storage.lastStreamList;
    var notifyTimeout = _this.gOptions.config.notifyTimeout;

    var onGetStreamList = function(streamList) {
        var notifyList = [];
        var now = parseInt(Date.now() / 1000);
        streamList.forEach(function(item) {
            var cItem = null;

            lastStreamList.some(function(exItem, index) {
                if (exItem._service === item._service && exItem._id === item._id) {
                    cItem = exItem;
                    lastStreamList.splice(index, 1);
                    return true;
                }
            });

            if (!cItem) {
                if (item._isNotified = _this.isNotDblItem(item)) {
                    notifyList.push(item);
                    debugLog('[s]', 'Nn', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                } else {
                    debugLog('[s]', 'D-', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                }
            } else {
                item._isNotified = cItem._isNotified;
                item._notifyTimeout = cItem._notifyTimeout;
                item._createTime = cItem._createTime;

                if (item._isNotified && item._notifyTimeout < now) {
                    item._isNotified = false;
                    delete item._notifyTimeout;
                }

                if (!item._isNotified && _this.isStatusChange(cItem, item)) {
                    item._isNotified = true;
                    notifyList.push(item);
                    debugLog('[s]', 'En', item._service, item._channelName, '#', item.channel.status, '#', item.game);
                }
            }

            if (item._isNotified && !item._notifyTimeout) {
                item._notifyTimeout = now + notifyTimeout * 60;
            }

            lastStreamList.push(item);
        });

        return _this.notifyAll(notifyList);
    };

    this.cleanStreamList(lastStreamList);

    return base.storage.set({lastStreamList: lastStreamList}).then(function() {
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

            var channelList = serviceChannelList[service];
            while (channelList.length) {
                var arr = channelList.splice(0, 100);
                var streamListPromise = (function getStreamList(service, arr, retry) {
                    return services[service].getStreamList(arr).catch(function(err) {
                        retry++;
                        if (retry >= 5) {
                            debug("Request stream list %s error! %s", service, err);
                            return [];
                        }

                        return new Promise(function(resolve) {
                            setTimeout(resolve, 5 * 1000);
                        }).then(function() {
                            debug("Retry %s request stream list %s! %s", retry, service, err);
                            return getStreamList(service, arr, retry);
                        });
                    });
                })(service, arr, 0);
                promiseList.push(streamListPromise.then(function(streamList) {
                    return onGetStreamList(streamList);
                }));
            }
        }

        return Promise.all(promiseList).then(function() {
            return base.storage.set({lastStreamList: lastStreamList});
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
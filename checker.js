/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');
var debugLog = require('debug')('checker:log');
debugLog.log = console.log.bind(console);
var request = require('request');
var requestPromise = Promise.promisify(request);

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error! "%s"', err);
        });
    });

    options.events.on('feed', function(data) {
        var channelList = [];

        var channelId = data['yt:channelId'];
        if (channelId) {
            channelList.push(channelId);
        }

        var userId = options.services.youtube.getUserId(channelId);
        if (userId) {
            channelList.push(userId);
        }

        var videoId = data['yt:videoId'];

        var hasVideoId = channelList.some(function(channelName) {
            return options.services.youtube.videoIdInList(channelName, videoId);
        });

        if (hasVideoId) {
            return;
        }

        // debug('Feed event, %j', data);

        _this.updateList({youtube: channelList}).catch(function(err) {
            debug('updateList error! "%s"', err);
        });
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

Checker.prototype.onSendMsgError = function(err, chatId) {
    var needKick = /^Error:\s+403\s+/.test(err);

    if (!needKick) {
        return;
    }

    var needSave = false;
    var chatList = this.gOptions.storage.chatList;
    for (var _chatId in chatList) {
        var item = chatList[_chatId];

        if (item.chatId === chatId) {
            debug('Remove chat "%s" %j', chatId, item);
            delete chatList[_chatId];
            needSave = true;
        }
    }

    needSave && base.storage.set({chatList: chatList});

    return true;
};

Checker.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var retryLimit = 0;

    var maxRetry = _this.gOptions.config.sendPhotoMaxRetry;
    if (maxRetry) {
        retryLimit = maxRetry;
    }

    var sendingPic = function(retry) {
        var sendPic = function(request) {
            return _this.gOptions.bot.sendPhoto(chatId, request, {
                caption: text
            }).then(function (msg) {
                var fileId = msg.photo[0].file_id;

                setTimeout(function() {
                    _this.track(chatId, stream, 'sendPhoto');
                });

                return fileId;
            }).catch(function(err) {
                var imgProcessError = [
                    /IMAGE_PROCESS_FAILED/,
                    /FILE_PART_0_MISSING/
                ].some(function(re) {
                    return re.test(err);
                });

                if (imgProcessError && retry < retryLimit) {
                    retry++;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, 5000);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s! %s", retry, chatId, stream._channelName, err);
                        return sendingPic(retry);
                    });
                }

                throw err;
            });
        };

        return requestPromise({
            url: stream.preview,
            encoding: null
        }).catch(function(err) {
            debug('Request photo error! %s %s %s', stream._channelName, stream.preview, err);
            throw 'Request photo error!';
        }).then(function(response) {
            var image = new Buffer(response.body, 'binary');
            return sendPic(image);
        });
    };

    return sendingPic(0).catch(function(err) {
        debug('Send photo file error! %s %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);

        if (isKicked) {
            throw 'Send photo file error! Bot was kicked!';
        }

        throw 'Send photo file error!';
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
            debug('Send text msg error! %s %s %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(err) {
            debug('Send photo msg error! %s %s %s', chatId, stream._channelName, err);

            _this.onSendMsgError(err, chatId);
        });
    };

    var send = function() {
        var photoId = stream._photoId;
        var promiseList = [];

        while (chatId = chatIdList.shift()) {
            if (!photoId) {
                promiseList.push(sendMsg(chatId));
            } else {
                promiseList.push(sendPic(chatId, photoId));
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

    var requestPicId = function() {
        if (!chatIdList.length) {
            debug('chatList is empty! %j', stream);
            return;
        }

        chatId = chatIdList.shift();

        return _this.getPicId(chatId, text, stream).then(function(fileId) {
            stream._photoId = fileId;
        }).catch(function(err) {
            if (err === 'Send photo file error! Bot was kicked!') {
                return requestPicId();
            }

            chatIdList.unshift(chatId);
            debug('Function getPicId throw error!', err);
        });
    };
    return requestPicId().then(function() {
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

    debugLog('[s] %j', videoItem);

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

Checker.prototype.cleanServices = function() {
    "use strict";
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var promiseList = [];

    for (var service in serviceChannelList) {
        if (!serviceChannelList.hasOwnProperty(service)) {
            continue;
        }

        var currentService = services[service];
        if (!currentService) {
            debug('Service "%s" is not found!', service);
            continue;
        }

        var channelList = serviceChannelList[service];

        if (currentService.clean) {
            promiseList.push(currentService.clean(channelList));
        }
    }

    return Promise.all(promiseList);
};

Checker.prototype.updateList = function(filterServiceChannelList) {
    "use strict";
    var _this = this;

    var isFullCheck = !filterServiceChannelList;

    var onGetVideoList = function(videoList) {
        if (isFullCheck) {
            var subscribeList = [];
            videoList.forEach(function(item) {
                var channelName = item._channelName;
                if (item._service === 'youtube' && subscribeList.indexOf(channelName) === -1) {
                    subscribeList.push(channelName);
                }
            });
            if (subscribeList.length) {
                debug('Subscribed %s channels! %j', subscribeList.length, subscribeList);
                _this.gOptions.events.emit('subscribe', subscribeList);
            }
        }

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

    var queue = Promise.resolve();

    if (isFullCheck) {
        queue = queue.then(function() {
            return _this.cleanServices().catch(function (err) {
                debug('cleanServices error! %j', err);
            });
        });
    }

    return Promise.try(function() {
        var serviceChannelList = _this.getChannelList();
        var services = _this.gOptions.services;

        for (var service in serviceChannelList) {
            if (!serviceChannelList.hasOwnProperty(service)) {
                continue;
            }

            (function(service){
                var currentService = services[service];
                if (!currentService) {
                    debug('Service "%s" is not found!', service);
                    return;
                }

                var channelList = JSON.parse(JSON.stringify(serviceChannelList[service]));

                var filterChannelList = filterServiceChannelList && filterServiceChannelList[service];
                if (service === 'youtube' && filterChannelList) {
                    channelList = filterChannelList.filter(function(channelName) {
                        return channelList.indexOf(channelName) !== -1;
                    });

                    if (!channelList.length) {
                        _this.gOptions.events.emit('unSubscribe', filterChannelList);
                    }
                }

                while (channelList.length) {
                    var arr = channelList.splice(0, 100);
                    (function(arr) {
                        var videoListPromise = (function getVideoList(retry) {
                            return currentService.getVideoList(arr, isFullCheck).catch(function(err) {
                                retry++;
                                if (retry >= 5) {
                                    debug("Request stream list %s error! %s", service, err);
                                    return [];
                                }

                                return new Promise(function(resolve) {
                                    setTimeout(resolve, 5 * 1000);
                                }).then(function() {
                                    debug("Retry %s request stream list %s! %s", retry, service, err);
                                    return getVideoList(retry);
                                });
                            });
                        })(0);

                        queue = queue.finally(function() {
                            return videoListPromise.then(function(videoList) {
                                return onGetVideoList(videoList);
                            })
                        });
                    })(arr);
                }

                queue = queue.finally(function () {
                    return currentService.saveState && currentService.saveState();
                });
            })(service);
        }

        return queue;
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
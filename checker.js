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

    this.requestPhotoCache = {};

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

        var channelUsername = channelId && options.services.youtube.getChannelUsername(channelId);
        if (channelUsername) {
            channelList.push(channelUsername);
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
    err = err && err.message || err;
    var needKick = /^403\s+/.test(err);

    if (!needKick) {
        needKick = /group chat is deactivated/.test(err);
    }

    var jsonRe = /^\d+\s+(\{.+})$/;
    if (jsonRe.test(err)) {
        var msg = null;
        try {
            msg = err.match(jsonRe);
            msg = msg && msg[1];
            msg = JSON.parse(msg);
        } catch (e) {
            msg = null;
        }

        if (msg && msg.parameters) {
            var parameters = msg.parameters;
            if (parameters.migrate_to_chat_id) {
                this.gOptions.chat.chatMigrate(chatId, parameters.migrate_to_chat_id);
            }
        }
    }

    if (!needKick) {
        return;
    }

    this.gOptions.chat.removeChat(chatId);
    return true;
};

Checker.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var sendPicLimit = 0;
    var sendPicTimeoutSec = 5;
    var requestLimit = 10;
    var requestTimeoutSec = 30;
    var tryNumber = 1;

    var refreshRetryLimit = function () {
        var _retryLimit = _this.gOptions.config.sendPhotoMaxRetry;
        if (_retryLimit) {
            sendPicLimit = _retryLimit;
        }

        var _retryTimeoutSec = _this.gOptions.config.sendPhotoRetryTimeoutSec;
        if (_retryTimeoutSec) {
            sendPicTimeoutSec = _retryTimeoutSec;
        }

        sendPicTimeoutSec *= 1000;
    };
    refreshRetryLimit();

    var refreshRequestLimit = function () {
        var _requestLimit = _this.gOptions.config.sendPhotoRequestLimit;
        if (_requestLimit) {
            requestLimit = _requestLimit;
        }

        var _requestTimeoutSec = _this.gOptions.config.sendPhotoRequestTimeoutSec;
        if (_requestTimeoutSec) {
            requestTimeoutSec = _requestTimeoutSec;
        }

        requestTimeoutSec *= 1000;
    };
    refreshRequestLimit();

    var previewList = stream.preview;
    if (!Array.isArray(previewList)) {
        previewList = [previewList];
    }

    var sendingPic = function() {
        var sendPic = function(request) {
            return Promise.try(function() {
                return _this.gOptions.bot.sendPhoto(chatId, request, {
                    caption: text
                });
            }).catch(function(err) {
                var imgProcessError = [
                    /IMAGE_PROCESS_FAILED/,
                    /FILE_PART_0_MISSING/
                ].some(function(re) {
                    return re.test(err);
                });

                if (imgProcessError && sendPicLimit > 0) {
                    sendPicLimit--;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, sendPicTimeoutSec);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s! %s", sendPicLimit, chatId, stream._channelName, err);
                        refreshRequestLimit();
                        return sendingPic();
                    });
                }

                throw err;
            });
        };

        var picIndex = null;
        var requestPic = function (index) {
            var previewUrl = previewList[index];
            return requestPromise({
                url: previewUrl,
                encoding: null,
                forever: true
            }).then(function (response) {
                if (response.statusCode === 404) {
                    throw new Error('404');
                }

                picIndex = index;
                return response;
            }).catch(function(err) {
                // debug('Request photo error! %s %s %s %s', index, stream._channelName, previewUrl, err);

                index++;
                if (index < previewList.length) {
                    return requestPic(index);
                }

                if (requestLimit > 0) {
                    requestLimit--;
                    return new Promise(function(resolve) {
                        setTimeout(resolve, requestTimeoutSec);
                    }).then(function() {
                        // debug("Retry %s request photo %s %s! %s", requestLimit, chatId, stream._channelName, err);
                        tryNumber++;
                        return requestPic(0);
                    });
                }

                throw 'Request photo error!';
            });
        };

        return requestPic(0).then(function (response) {
            if (tryNumber > 1 || picIndex > 0) {
                debug('Try: %s, photo index: %s send! %s %s', tryNumber, picIndex, stream._channelName, stream._videoId);
            }

            var image = new Buffer(response.body, 'binary');
            return sendPic(image);
        });
    };

    return sendingPic().catch(function(err) {
        debug('Send photo file error! %s %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);

        if (isKicked) {
            throw 'Send photo file error! Bot was kicked!';
        }

        throw 'Send photo file error!';
    });
};

Checker.prototype.getPicIdCache = function (chatId, text, stream) {
    var cache = this.requestPhotoCache;
    return cache[stream._videoId] = this.getPicId(chatId, text, stream).then(function (msg) {
        delete cache[stream._videoId];
        return msg;
    }).catch(function (e) {
        delete cache[stream._videoId];
        throw e;
    });
};

Checker.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;

    var bot = _this.gOptions.bot;
    var sendMsg = function(chatId) {
        return bot.sendMessage(chatId, noPhotoText, {
            disable_web_page_preview: true,
            parse_mode: 'HTML'
        }).then(function() {
            _this.track(chatId, stream, 'sendMsg');
        }).catch(function(err) {
            debug('Send text msg error! %s %s %s', chatId, stream._channelName, err);

            var isKicked = _this.onSendMsgError(err, chatId);
            if (!isKicked) {
                throw err;
            }
        });
    };

    var sendPic = function(chatId, fileId) {
        return bot.sendPhoto(chatId, fileId, {
            caption: text
        }).then(function() {
            _this.track(chatId, stream, 'sendPhoto');
        }).catch(function(err) {
            debug('Send photo msg error! %s %s %s', chatId, stream._channelName, err);

            var isKicked = _this.onSendMsgError(err, chatId);
            if (!isKicked) {
                throw err;
            }
        });
    };

    var send = function() {
        var chatId = null;
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

    if (!stream.preview || (Array.isArray(stream.preview) && stream.preview.length === 0)) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    var requestPicId = function() {
        if (!chatIdList.length) {
            debug('chatList is empty! %j', stream);
            return Promise.resolve();
        }

        var promise = _this.requestPhotoCache[stream._videoId];
        if (promise) {
            return promise.then(function(msg) {
                stream._photoId = msg.photo[0].file_id;
            }).catch(function(err) {
                if (err === 'Send photo file error! Bot was kicked!') {
                    return requestPicId();
                }
            });
        }

        var chatId = chatIdList.shift();

        return _this.getPicIdCache(chatId, text, stream).then(function(msg) {
            stream._photoId = msg.photo[0].file_id;

            _this.track(chatId, stream, 'sendPhoto');
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
            return a.publishedAt > b.publishedAt;
        });

        _this.gOptions.events.emit('notifyAll', videoList);
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

        Object.keys(serviceChannelList).forEach(function (service) {
            var currentService = services[service];
            if (!currentService) {
                debug('Service "%s" is not found!', service);
                return;
            }

            var channelList = serviceChannelList[service];

            var filterChannelList = filterServiceChannelList && filterServiceChannelList[service];
            if (filterChannelList && service === 'youtube') {
                channelList = filterChannelList.filter(function(channelName) {
                    return channelList.indexOf(channelName) !== -1;
                });

                if (!channelList.length) {
                    _this.gOptions.events.emit('unsubscribe', filterChannelList);
                }
            }

            queue = queue.finally(function() {
                return currentService.getVideoList(channelList, isFullCheck).then(function(videoList) {
                    return onGetVideoList(videoList);
                });
            });
        });

        return queue;
    });
};

Checker.prototype.track = function(chatId, stream, title) {
    "use strict";
    return this.gOptions.tracker.track({
        text: stream._channelName,
        from: {
            id: 1
        },
        chat: {
            id: chatId
        },
        date: base.getNow()
    }, title);
};

module.exports = Checker;
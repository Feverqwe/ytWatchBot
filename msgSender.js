/**
 * Created by Anton on 02.10.2016.
 */
var base = require('./base');
var debug = require('debug')('MsgSender');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var MsgSender = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    this.requestPhotoCache = {};
};

MsgSender.prototype.onSendMsgError = function(err, chatId) {
    var _this = this;
    err = err && err.message || err;
    var needKick = /^403\s+/.test(err);

    if (!needKick) {
        needKick = [
            /group chat is deactivated/,
            /chat not found"/,
            /channel not found"/,
            /USER_DEACTIVATED/
        ].some(function (re) {
            return re.test(err);
        });
    }

    var errorJson = /^\d+\s+(\{.+})$/.exec(err);
    errorJson = errorJson && errorJson[1];
    if (errorJson) {
        var msg = null;
        try {
            msg = JSON.parse(errorJson);
        } catch (e) {}

        if (msg && msg.parameters) {
            var parameters = msg.parameters;
            if (parameters.migrate_to_chat_id) {
                _this.gOptions.chat.chatMigrate(chatId, parameters.migrate_to_chat_id);
            }
        }
    }

    if (needKick) {
        if (/^@\w+$/.test(chatId)) {
            _this.gOptions.chat.removeChannel(chatId);
        } else {
            _this.gOptions.chat.removeChat(chatId);
        }
    }

    return needKick;
};

/**
 * @private
 */
MsgSender.prototype.downloadImg = function (stream) {
    "use strict";
    var _this = this;
    var requestLimit = 10;
    var requestTimeoutSec = 30;

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

    var requestPic = function (index) {
        var previewUrl = previewList[index];
        return requestPromise({
            url: previewUrl,
            encoding: null,
            gzip: true,
            forever: true
        }).then(function (response) {
            if (response.statusCode === 404) {
                throw new Error('404');
            }

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
                    return requestPic(0);
                });
            }

            throw 'Request photo error!';
        });
    };

    return requestPic(0).then(function (response) {
        var image = new Buffer(response.body, 'binary');
        return image;
    });
};

/**
 * @private
 */
MsgSender.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;
    var sendPicLimit = 0;
    var sendPicTimeoutSec = 5;

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

    var sendingPic = function() {
        var sendPic = function(photo) {
            return Promise.try(function() {
                return _this.gOptions.bot.sendPhoto(chatId, photo, {
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
                        return sendingPic();
                    });
                }

                throw err;
            });
        };

        return _this.downloadImg(stream).then(function (buffer) {
            return sendPic(buffer);
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

/**
 * @private
 */
MsgSender.prototype.getPicIdCache = function (chatId, text, stream) {
    var cache = this.requestPhotoCache;
    var id = stream._videoId;

    return cache[id] = this.getPicId(chatId, text, stream).finally(function () {
        delete cache[id];
    });
};

MsgSender.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;

    var bot = _this.gOptions.bot;
    var sendMsg = function(chatId) {
        return bot.sendMessage(chatId, noPhotoText, {
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

    var sendPhoto = function(chatId, fileId) {
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
            if (!photoId || !text) {
                promiseList.push(sendMsg(chatId));
            } else {
                promiseList.push(sendPhoto(chatId, photoId));
            }
        }

        return Promise.all(promiseList);
    };

    if (!stream.preview.length) {
        return send();
    }

    if (!text) {
        return send();
    }

    if (useCache && stream._photoId) {
        return send();
    }

    var requestPicId = function() {
        if (!chatIdList.length) {
            // debug('chatList is empty! %j', stream);
            return Promise.resolve();
        }

        var promise = _this.requestPhotoCache[stream._videoId];
        if (promise) {
            return promise.then(function(msg) {
                stream._photoId = msg.photo[0].file_id;
            }, function(err) {
                if (err === 'Send photo file error! Bot was kicked!') {
                    return requestPicId();
                }
            });
        }

        var chatId = chatIdList.shift();

        return _this.getPicIdCache(chatId, text, stream).then(function(msg) {
            stream._photoId = msg.photo[0].file_id;

            _this.track(chatId, stream, 'sendPhoto');
        }, function(err) {
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

/**
 * @private
 */
MsgSender.prototype.track = function(chatId, stream, title) {
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


module.exports = MsgSender;
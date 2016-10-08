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
    _this.gOptions = options;

    _this.requestPromiseMap = {};

    _this.threadLimit = new base.ThreadLimit(10);
};

MsgSender.prototype.onSendMsgError = function(err, chatId) {
    "use strict";
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
    var _requestLimit = _this.gOptions.config.sendPhotoRequestLimit;
    if (_requestLimit) {
        requestLimit = _requestLimit;
    }

    var requestTimeoutSec = 30;
    var _requestTimeoutSec = _this.gOptions.config.sendPhotoRequestTimeoutSec;
    if (_requestTimeoutSec) {
        requestTimeoutSec = _requestTimeoutSec;
    }
    requestTimeoutSec *= 1000;

    var previewList = stream.preview;

    var requestPic = function (index) {
        var previewUrl = previewList[index];
        return requestPromise({
            method: 'HEAD',
            url: previewUrl,
            gzip: true,
            forever: true
        }).then(function (response) {
            if (response.statusCode !== 200) {
                throw new Error(response.statusCode);
            }

            return response.request.href;
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

            throw err;
        });
    };

    return requestPic(0).catch(function (err) {
        debug('requestPic error %s %s', stream._channelName, err);

        throw err;
    });
};

/**
 * @private
 */
MsgSender.prototype.getPicId = function(chatId, text, stream) {
    "use strict";
    var _this = this;

    var sendPicLimit = 0;
    var _retryLimit = _this.gOptions.config.sendPhotoMaxRetry;
    if (_retryLimit) {
        sendPicLimit = _retryLimit;
    }

    var sendPicTimeoutSec = 5;
    var _retryTimeoutSec = _this.gOptions.config.sendPhotoRetryTimeoutSec;
    if (_retryTimeoutSec) {
        sendPicTimeoutSec = _retryTimeoutSec;
    }
    sendPicTimeoutSec *= 1000;

    var sendingPic = function() {
        var sendPic = function(photoUrl) {
            var photoStream = request({
                url: photoUrl,
                forever: true
            });

            return _this.gOptions.bot.sendPhoto(chatId, photoStream, {
                caption: text
            }).catch(function(err) {
                var isKicked = _this.onSendMsgError(err, chatId);
                if (isKicked) {
                    throw 'Send photo file error! Bot was kicked!';
                }

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

                debug('sendPic error %s %s %s', chatId, stream._channelName, err);

                throw err;
            });
        };

        return _this.downloadImg(stream).then(function (photoUrl) {
            var sendPicQuote = _this.gOptions.botQuote.wrapper(sendPic);
            var sendPicQuoteThreadLimit = _this.threadLimit.wrapper(sendPicQuote);
            return sendPicQuoteThreadLimit(photoUrl);
        });
    };

    return sendingPic();
};

/**
 * @private
 */
MsgSender.prototype.sendMsg = function(chatId, noPhotoText, stream) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;

    return bot.sendMessage(chatId, noPhotoText, {
        parse_mode: 'HTML'
    }).then(function() {
        _this.track(chatId, stream, 'sendMsg');
    }, function(err) {
        debug('Send text msg error! %s %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);
        if (!isKicked) {
            throw err;
        }
    });
};

/**
 * @private
 */
MsgSender.prototype.sendPhoto = function(chatId, fileId, text, stream) {
    "use strict";
    var _this = this;
    var bot = _this.gOptions.bot;

    return bot.sendPhotoQuote(chatId, fileId, {
        caption: text
    }).then(function() {
        _this.track(chatId, stream, 'sendPhoto');
    }, function(err) {
        debug('Send photo msg error! %s %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);
        if (!isKicked) {
            throw err;
        }
    });
};

/**
 * @private
 */
MsgSender.prototype.send = function(chatIdList, text, noPhotoText, stream) {
    "use strict";
    var _this = this;
    var photoId = stream._photoId;
    var promiseList = [];

    var chatId = null;
    while (chatId = chatIdList.shift()) {
        if (!photoId || !text) {
            promiseList.push(_this.sendMsg(chatId, noPhotoText, stream));
        } else {
            promiseList.push(_this.sendPhoto(chatId, photoId, text, stream));
        }
    }

    return Promise.all(promiseList);
};

/**
 * @private
 */
MsgSender.prototype.requestPicId = function(chatIdList, text, stream) {
    "use strict";
    var _this = this;
    var requestPromiseMap = _this.requestPromiseMap;
    var requestId = stream._videoId;

    if (!chatIdList.length) {
        // debug('chatList is empty! %j', stream);
        return Promise.resolve();
    }

    var promise = requestPromiseMap[requestId];
    if (promise) {
        promise = promise.then(function (msg) {
            stream._photoId = msg.photo[0].file_id;
        }, function(err) {
            if (err === 'Send photo file error! Bot was kicked!') {
                return _this.requestPicId(chatIdList, text, stream);
            }
        });
    } else {
        var chatId = chatIdList.shift();

        promise = requestPromiseMap[requestId] = _this.getPicId(chatId, text, stream).finally(function () {
            delete requestPromiseMap[requestId];
        });

        promise = promise.then(function (msg) {
            stream._photoId = msg.photo[0].file_id;

            _this.track(chatId, stream, 'sendPhoto');
        }, function (err) {
            if (err === 'Send photo file error! Bot was kicked!') {
                return _this.requestPicId(chatIdList, text, stream);
            }

            chatIdList.unshift(chatId);
            // debug('Function getPicId throw error!', err);
        });
    }

    return promise;
};

MsgSender.prototype.sendNotify = function(chatIdList, text, noPhotoText, stream, useCache) {
    "use strict";
    var _this = this;

    if (!stream.preview.length) {
        return _this.send(chatIdList, text, noPhotoText, stream);
    }

    if (!text) {
        return _this.send(chatIdList, text, noPhotoText, stream);
    }

    if (useCache && stream._photoId) {
        return _this.send(chatIdList, text, noPhotoText, stream);
    }

    return _this.requestPicId(chatIdList, text, stream).then(function() {
        return _this.send(chatIdList, text, noPhotoText, stream);
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
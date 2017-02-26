/**
 * Created by Anton on 02.10.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:MsgSender');
var request = require('request');
var requestPromise = require('request-promise');

var MsgSender = function (options) {
    var _this = this;
    _this.gOptions = options;
};

MsgSender.prototype.getValidPhotoUrl = function (stream) {
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
            forever: true,
            resolveWithFullResponse: true
        }).then(function (response) {
            return response.request.href;
        }).catch(function(err) {
            // debug('Request photo error! %s %s %s', index, stream._channelName, previewUrl, err);

            index++;
            if (index < previewList.length) {
                return requestPic(index);
            }

            requestLimit--;
            if (requestLimit > 0) {
                return new Promise(function(resolve) {
                    setTimeout(resolve, requestTimeoutSec);
                }).then(function() {
                    // debug("Retry %s request photo %s %s!", requestLimit, chatId, stream._channelName, err);
                    return requestPic(0);
                });
            }

            throw err;
        });
    };

    return requestPic(0).catch(function (err) {
        debug('requestPic error %s', stream._channelName, err);

        throw err;
    });
};

MsgSender.prototype.getPicId = function(chatId, text, stream) {
    var _this = this;

    var sendingPic = function () {
        var uploadPhoto = function (photoUrl) {
            return _this.gOptions.bot.sendPhoto(chatId, request({
                url: photoUrl,
                forever: true
            }), {
                caption: text
            });
        };

        var sendPhotoUrl = function (photoUrl) {
            return _this.gOptions.bot.sendPhoto(chatId, photoUrl, {
                caption: text
            });
        };

        return _this.getValidPhotoUrl(stream).then(function (photoUrl) {
            return sendPhotoUrl(photoUrl).catch(function (err) {
                var errList = [
                    /failed to get HTTP URL content/,
                    /wrong type of the web page content/
                ];
                var isLoadUrlError = errList.some(function (re) {
                    return re.test(err.message);
                });

                if (!isLoadUrlError) {
                    throw err;
                }

                return uploadPhoto(photoUrl);
            });
        });
    };

    return sendingPic();
};

MsgSender.prototype.sendMsg = function(chatId, noPhotoText, stream) {
    var _this = this;
    return _this.gOptions.bot.sendMessage(chatId, noPhotoText, {
        parse_mode: 'HTML'
    }).then(function() {
        _this.track(chatId, stream, 'sendMsg');
    });
};

MsgSender.prototype.sendPhoto = function(chatId, fileId, text, stream) {
    var _this = this;
    return _this.gOptions.bot.sendPhotoQuote(chatId, fileId, {
        caption: text
    }).then(function() {
        _this.track(chatId, stream, 'sendPhoto');
    });
};

MsgSender.prototype.send = function(chatIdList, imageFileId, text, noPhotoText, stream) {
    var _this = this;

    var getPromise = function (chatId) {
        var promise;
        if (!imageFileId || !text) {
            promise = _this.sendMsg(chatId, noPhotoText, stream);
        } else {
            promise = _this.sendPhoto(chatId, imageFileId, text, stream);
        }
        return promise.catch(base.onSendMsgError.bind(null, _this.gOptions, chatId));
    };

    var chatId, promise = Promise.resolve();
    while (chatId = chatIdList.shift()) {
        promise = promise.then(getPromise.bind(null, chatId));
    }

    return promise;
};

MsgSender.prototype.requestPicId = function(chatIdList, text, stream) {
    var _this = this;

    if (!chatIdList.length) {
        return Promise.resolve();
    }

    var chatId = chatIdList.shift();

    return _this.getPicId(chatId, text, stream).then(function (msg) {
        _this.track(chatId, stream, 'sendPhoto');

        var imageFileId = null;
        msg.photo.some(function (item) {
            return imageFileId = item.file_id;
        });
        return imageFileId;
    }).catch(function (err) {
        return base.onSendMsgError(_this.gOptions, chatId, err).then(function () {
            return _this.requestPicId(chatIdList, text, stream);
        });
    }).catch(function (err) {
        debug('requestPicId error!', err);
        chatIdList.unshift(chatId);
    });
};

MsgSender.prototype.sendNotify = function(messageId, imageFileId, chatIdList, text, noPhotoText, stream, useCache) {
    var _this = this;

    if (!stream.preview.length) {
        return _this.send(chatIdList, imageFileId, text, noPhotoText, stream);
    }

    if (!text) {
        return _this.send(chatIdList, imageFileId, text, noPhotoText, stream);
    }

    if (useCache && imageFileId) {
        return _this.send(chatIdList, imageFileId, text, noPhotoText, stream);
    }

    return _this.requestPicId(chatIdList, text, stream).then(function(imageFileId) {
        return imageFileId && _this.gOptions.msgStack.setImageFileId(messageId, imageFileId).then(function () {
            return imageFileId;
        });
    }).then(function (imageFileId) {
        return _this.send(chatIdList, imageFileId, text, noPhotoText, stream);
    });
};

MsgSender.prototype.track = function(chatId, stream, title) {
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
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

MsgSender.prototype.onSendMsgError = function(err, chatId) {
    var _this = this;
    var errMsg = err.message;
    var needKick = /^403\s+/.test(errMsg);

    if (!needKick) {
        needKick = [
            /group chat is deactivated/,
            /chat not found"/,
            /channel not found"/,
            /USER_DEACTIVATED/
        ].some(function (re) {
            return re.test(errMsg);
        });
    }

    var errorJson = /^\d+\s+(\{.+})$/.exec(errMsg);
    errorJson = errorJson && errorJson[1];
    if (errorJson) {
        var msg = null;
        try {
            msg = JSON.parse(errorJson);
        } catch (e) {}

        if (msg && msg.parameters) {
            var parameters = msg.parameters;
            if (parameters.migrate_to_chat_id) {
                _this.gOptions.users.changeChatId(chatId, parameters.migrate_to_chat_id);
            }
        }
    }

    if (needKick) {
        if (/^@\w+$/.test(chatId)) {
            _this.gOptions.users.removeChatChannel(chatId);
        } else {
            _this.gOptions.users.removeChat(chatId);
        }
    }

    return needKick;
};

MsgSender.prototype.downloadImg = function (stream) {
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
            var options = {
                caption: text
            };
            return _this.gOptions.bot.sendPhoto(chatId, photoUrl, options).catch(function (err) {
                var errList = [
                    /failed to get HTTP URL content/,
                    /HTTP URL specified/
                ];

                var isManualUpload = errList.some(function (re) {
                    return re.test(err.message);
                });
                if (isManualUpload) {
                    return _this.gOptions.bot.sendPhoto(chatId, request({
                        url: photoUrl,
                        forever: true
                    }), options);
                }

                throw err;
            }).catch(function(err) {
                var isKicked = _this.onSendMsgError(err, chatId);
                if (isKicked) {
                    throw new Error('Send photo file error! Bot was kicked!');
                }

                var imgProcessError = [
                    /Failed to get HTTP URL content/
                ].some(function(re) {
                    return re.test(err);
                });

                sendPicLimit--;
                if (imgProcessError && sendPicLimit > 0) {
                    return new Promise(function(resolve) {
                        setTimeout(resolve, sendPicTimeoutSec);
                    }).then(function() {
                        debug("Retry %s send photo file %s %s!", sendPicLimit, chatId, stream._channelName, err);
                        return sendingPic();
                    });
                }

                debug('sendPic error %s %s %s', chatId, stream._channelName, photoUrl, err);

                throw err;
            });
        };

        return _this.downloadImg(stream).then(function (photoUrl) {
            return sendPic(photoUrl);
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
    }).catch(function(err) {
        debug('Send text msg error! %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);
        if (!isKicked) {
            throw err;
        }
    });
};

MsgSender.prototype.sendPhoto = function(chatId, fileId, text, stream) {
    var _this = this;
    return _this.gOptions.bot.sendPhoto(chatId, fileId, {
        caption: text
    }).then(function() {
        _this.track(chatId, stream, 'sendPhoto');
    }).catch(function(err) {
        debug('Send photo msg error! %s %s', chatId, stream._channelName, err);

        var isKicked = _this.onSendMsgError(err, chatId);
        if (!isKicked) {
            throw err;
        }
    });
};

MsgSender.prototype.send = function(chatIdList, imageFileId, text, noPhotoText, stream) {
    var _this = this;
    var promiseList = [];

    var chatId;
    while (chatId = chatIdList.shift()) {
        if (!imageFileId || !text) {
            promiseList.push(_this.sendMsg(chatId, noPhotoText, stream));
        } else {
            promiseList.push(_this.sendPhoto(chatId, imageFileId, text, stream));
        }
    }

    return Promise.all(promiseList);
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
        if (err.message === 'Send photo file error! Bot was kicked!') {
            return _this.requestPicId(chatIdList, text, stream);
        }

        chatIdList.unshift(chatId);
        // debug('Function getPicId throw error!', err);
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
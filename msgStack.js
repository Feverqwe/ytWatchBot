/**
 * Created by Anton on 21.05.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:MsgStack');
var debugLog = require('debug')('app:MsgStack:log');
debugLog.log = console.log.bind(console);
var Promise = require('bluebird');

var MsgStack = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};

    options.events.on('checkStack', function () {
        _this.checkStack();
    });

    this.promiseChatIdMap = {};

    this.onReady = this.init();
};

MsgStack.prototype.init = function () {
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `messages` ( \
                `id` INT NOT NULL AUTO_INCREMENT, \
                `videoId` VARCHAR(255) NOT NULL, \
                `channelId` VARCHAR(255) NOT NULL, \
                `publishedAt` TEXT NOT NULL, \
                `data` TEXT NOT NULL, \
                `imageFileId` TEXT, \
            PRIMARY KEY (`id`),\
            UNIQUE INDEX `videoIdChannelId_UNIQUE` (`videoId` ASC, `channelId` ASC)); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                CREATE TABLE IF NOT EXISTS `userIdMessageId` ( \
                    `userId` VARCHAR(255) NOT NULL, \
                    `messageId` INT NOT NULL, \
                UNIQUE INDEX `userIdMessageId_UNIQUE` (`userId` ASC, `messageId` ASC), \
                FOREIGN KEY (`messageId`) \
                    REFERENCES `messages` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE); \
            ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    return promise;
};

MsgStack.prototype.insertInStack = function (userId, messageId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO userIdMessageId SET userId = ?, messageId = ? ON DUPLICATE KEY UPDATE userId = userId \
        ', [userId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.getChatIdList = function (service, channelId) {
    var chatList = this.gOptions.storage.chatList;
    var chatIdList = [];
    var chatItem, userChannelList;
    for (var chatId in chatList) {
        chatItem = chatList[chatId];
        if (chatItem.serviceList) {
            userChannelList = chatItem.serviceList[service];
            if (userChannelList) {
                if (userChannelList.indexOf(channelId) !== -1) {
                    chatIdList.push(chatItem.chatId);
                }
            }
        }
    }
    return chatIdList;
};

MsgStack.prototype.callMsgList = function (chatId) {
    var _this = this;
    var chatMsgStack = this.config.chatMsgStack;

    var msgStack = chatMsgStack[chatId];
    if (!msgStack) {
        return Promise.resolve();
    }

    if (msgStack.timeout > base.getNow()) {
        return Promise.resolve();
    }
    
    var msgList = msgStack.stack || [];
    var sendNextMsg = function () {
        if (!msgList.length) {
            delete chatMsgStack[chatId];
            return Promise.resolve();
        }

        return Promise.try(function () {
            var msgId = msgList[0];
            var chatList = [];
            var videoItem = _this.stack.getItem(msgId);
            if (!videoItem) {
                debug('VideoItem is not found! %s', msgId);
                base.removeItemFromArray(msgList, msgId);
                return;
            }

            var chatItem = _this.gOptions.storage.chatList[chatId];
            if (!chatItem) {
                debug('chatItem is not found! %s %s', chatId, msgId);
                throw new Error('chatItem is not found!');
            }
            
            var options = chatItem.options || {};

            var text = null;
            if (!options.hidePreview) {
                text = base.getNowStreamPhotoText(_this.gOptions, videoItem);
            }
            var noPhotoText = base.getNowStreamText(_this.gOptions, videoItem);

            if (options.channel) {
                !options.mute && chatList.push(chatItem.chatId);
                chatList.push(options.channel);
            } else {
                chatList.push(chatItem.chatId);
            }

            return _this.gOptions.msgSender.sendNotify(chatList, text, noPhotoText, videoItem, true).then(function () {
                base.removeItemFromArray(msgList, msgId);
                delete msgStack.timeout;
                return _this.saveChatMsgStack();
            });
        }).then(function () {
            return sendNextMsg();
        });
    };

    return sendNextMsg().catch(function (e) {
        var timeout = 5 * 60;
        if (/PEER_ID_INVALID/.test(e)) {
            timeout = 6 * 60 * 60;
        }
        msgStack.timeout = base.getNow() + timeout;

        debug('sendNextMsg error!', e);
    });
};

MsgStack.prototype.callStack = function () {
    var _this = this;
    var promiseChatIdMap = _this.promiseChatIdMap;
    var promiseList = [];
    var chatMsgStack = _this.config.chatMsgStack;
    Object.keys(chatMsgStack).forEach(function (chatId) {
        var promise = promiseChatIdMap[chatId] || Promise.resolve();

        promise = promiseChatIdMap[chatId] = promise.then(function () {
            return _this.callMsgList(chatId);
        }).finally(function () {
            if (promiseChatIdMap[chatId] === promise) {
                delete promiseChatIdMap[chatId];
            }
        });

        promiseList.push(promise);
    });
    return Promise.all(promiseList);
};

MsgStack.prototype.sendLog = function (stream) {
    var debugItem = JSON.parse(JSON.stringify(stream));
    delete debugItem.preview;
    delete debugItem._videoId;
    delete debugItem._photoId;
    debugLog('[s] %j', debugItem);
};

MsgStack.prototype.checkStack = function () {
    var _this = this;

    console.log('checkStack')
    // return _this.callStack();
};

module.exports = MsgStack;
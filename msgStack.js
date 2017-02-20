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
                `data` LONGTEXT NOT NULL, \
                `imageFileId` TEXT NULL, \
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
                    `timeout` INT NULL DEFAULT 0, \
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

MsgStack.prototype.insertInStack = function (connection, userId, messageId) {
    return new Promise(function (resolve, reject) {
        connection.query('\
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

/**
 * @typedef {{}} StackItem
 * @property {String} userId
 * @property {Number} messageId
 * @property {Number} timeout
 * @property {Number} id
 * @property {String} videoId
 * @property {String} channelId
 * @property {String} publishedAt
 * @property {String} data
 * @property {String} [imageFileId]
 */
MsgStack.prototype.getStackItems = function () {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM userIdMessageId \
            LEFT JOIN messages ON userIdMessageId.messageId = messages.id \
            WHERE userIdMessageId.timeout < ? \
            GROUP BY messages.id \
            ORDER BY messages.publishedAt ASC \
            LIMIT 30; \
        ', [base.getNow()], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
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

MsgStack.prototype.sendLog = function (userId, messageId, data) {
    var debugItem = JSON.parse(JSON.stringify(data));
    delete debugItem.preview;
    delete debugItem._videoId;
    debugLog('[s] %s %s %j', userId, messageId, debugItem);
};

MsgStack.prototype.setTimeout = function (userId, messageId, timeout) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE userIdMessageId SET timeout = ? WHERE userId = ? AND messageId = ?; \
        ', [timeout, userId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.setImageFileId = function (messageId, imageFileId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE messages SET imageFileId = ? WHERE id = ?; \
        ', [imageFileId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.removeItem = function (userId, messageId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM userIdMessageId WHERE userId = ? AND messageId = ?; \
        ', [userId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.sendItem = function (/*StackItem*/item) {
    var _this = this;
    var userId = item.userId;
    var messageId = item.messageId;
    var imageFileId = item.imageFileId;
    var data = JSON.parse(item.data);
    return _this.setTimeout(userId, messageId, base.getNow() + 5 * 60).then(function () {
        var chatItem = _this.gOptions.storage.chatList[userId];
        if (!chatItem) {
            debug('chatItem is not found! %s %s', userId, messageId);
            return Promise.resolve();
        }
        var options = chatItem.options || {};

        var text = '';
        if (!options.hidePreview) {
            text = base.getNowStreamPhotoText(_this.gOptions, data);
        }
        var noPhotoText = base.getNowStreamText(_this.gOptions, data);

        var chatList = [];
        if (options.channel) {
            !options.mute && chatList.push(userId);
            chatList.push(options.channel);
        } else {
            chatList.push(userId);
        }

        return _this.gOptions.msgSender.sendNotify(messageId, imageFileId, chatList, text, noPhotoText, data, true);
    }).then(function () {
        _this.sendLog(userId, messageId, data);
        return _this.removeItem(userId, messageId);
    }).catch(function (err) {
        if (/PEER_ID_INVALID/.test(err)) {
            return _this.setTimeout(userId, messageId, base.getNow() + 6 * 60 * 60);
        }

        debug('sendItem', userId, messageId, err);
    });
};

MsgStack.prototype.checkStack = function () {
    var _this = this;

    // 300 by 30 = 9000 msg per checkStack
    var limit = 300;
    (function nextPart() {
        return _this.getStackItems().then(function (/*[StackItem]*/items) {
            if (!items.length) return;

            return Promise.all(items.map(function (item) {
                return _this.sendItem(item);
            })).then(function () {
                if (limit-- < 1) {
                    debug('checkStack part limit!');
                } else {
                    return nextPart();
                }
            });
        });
    })();
};

module.exports = MsgStack;
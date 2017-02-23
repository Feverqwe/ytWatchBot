/**
 * Created by Anton on 21.05.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:MsgStack');
var debugLog = require('debug')('app:MsgStack:log');
debugLog.log = console.log.bind(console);

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
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `videoId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `publishedAt` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                `data` LONGTEXT CHARACTER SET utf8mb4 NOT NULL, \
                `imageFileId` TEXT CHARACTER SET utf8mb4 NULL, \
            UNIQUE INDEX `videoIdChannelId_UNIQUE` (`videoId` ASC, `channelId` ASC), \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC)); \
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
                    `userId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `messageId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
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
            LIMIT 10; \
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
    var _this = this;
    return _this.gOptions.users.getChatIdsByChannel(service, channelId).then(function (chatIdList) {
        return chatIdList;
    });
};

MsgStack.prototype.sendLog = function (userId, messageId, data) {
    var debugItem = JSON.parse(JSON.stringify(data));
    delete debugItem.preview;
    delete debugItem._videoId;
    debugLog('[s] %s %s %j', messageId, userId, debugItem);
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
    return Promise.resolve().then(function () {
        var data = null;
        if (/^%/.test(item.data)) {
            data = JSON.parse(decodeURIComponent(item.data));
        } else {
            data = JSON.parse(item.data);
        }

        return _this.gOptions.gOptions.users.getChat(userId).then(function (user) {
            if (!user) {
                debug('Can\'t send message %s, user %s is not found!', messageId, userId);
                return;
            }

            var options = user.data ? JSON.parse(user.data) : {};

            var text = base.getNowStreamText(_this.gOptions, data);
            var caption = '';
            if (!options.hidePreview) {
                caption = base.getNowStreamPhotoText(_this.gOptions, data);
            }

            var chatList = [];
            if (user.channelId) {
                if (!options.mute) {
                    chatList.push(user.id);
                }
                chatList.push(user.channelId);
            } else {
                chatList.push(user.id);
            }

            return _this.gOptions.msgSender.sendNotify(messageId, imageFileId, chatList, caption, text, data, true).then(function () {
                _this.sendLog(user.id, messageId, data);
            });
        });
    }).then(function () {
        return _this.removeItem(userId, messageId);
    }).catch(function (err) {
        debug('sendItem', userId, messageId, err);

        var timeout = 5 * 60;
        if (/PEER_ID_INVALID/.test(err)) {
            timeout = 6 * 60 * 60;
        }
        return _this.setTimeout(userId, messageId, base.getNow() + timeout);
    });
};

var lock = false;

MsgStack.prototype.checkStack = function () {
    if (lock) return;
    lock = true;

    var _this = this;

    // 300 by 10 = 3000 msg per checkStack
    var limit = 300;
    (function nextPart() {
        return _this.getStackItems().then(function (/*[StackItem]*/items) {
            if (!items.length) {
                lock = false;
                return;
            }

            return Promise.all(items.map(function (item) {
                return _this.sendItem(item);
            })).then(function () {
                if (limit-- < 1) {
                    debug('checkStack part limit!');
                    lock = false;
                } else {
                    return nextPart();
                }
            });
        });
    })();
};

module.exports = MsgStack;
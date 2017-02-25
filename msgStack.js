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
                CREATE TABLE IF NOT EXISTS `chatIdMessageId` ( \
                    `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `messageId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `timeout` INT NULL DEFAULT 0, \
                UNIQUE INDEX `chatIdMessageId_UNIQUE` (`chatId` ASC, `messageId` ASC), \
                FOREIGN KEY (`chatId`) \
                    REFERENCES `chats` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE,\
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

MsgStack.prototype.addChatMessage = function (connection, chatId, messageId) {
    return new Promise(function (resolve, reject) {
        connection.query('\
            INSERT INTO chatIdMessageId SET chatId = ?, messageId = ? ON DUPLICATE KEY UPDATE chatId = chatId \
        ', [chatId, messageId], function (err, results) {
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
 * @property {String} chatId
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
            SELECT * FROM chatIdMessageId \
            LEFT JOIN messages ON chatIdMessageId.messageId = messages.id \
            WHERE chatIdMessageId.timeout < ? \
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

MsgStack.prototype.sendLog = function (chatId, messageId, data) {
    var debugItem = JSON.parse(JSON.stringify(data));
    delete debugItem.preview;
    delete debugItem._videoId;
    debugLog('[s] %s %s %j', messageId, chatId, debugItem);
};

MsgStack.prototype.setTimeout = function (chatId, messageId, timeout) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE chatIdMessageId SET timeout = ? WHERE chatId = ? AND messageId = ?; \
        ', [timeout, chatId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.messageIdsExists = function (ids) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        var inArray = ids.map(function (id) {
            return db.connection.escape(id);
        });
        inArray = '(' + inArray.join(',') + ')';
        db.connection.query('\
            SELECT id FROM messages WHERE id IN ' + inArray + '; \
            ', function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results.map(function (item) {
                    return item.id;
                }));
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

MsgStack.prototype.removeItem = function (chatId, messageId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM chatIdMessageId WHERE chatId = ? AND messageId = ?; \
        ', [chatId, messageId], function (err, results) {
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
    var chatId = item.chatId;
    var messageId = item.messageId;
    var imageFileId = item.imageFileId;
    return Promise.resolve().then(function () {
        var data = null;
        if (/^%/.test(item.data)) {
            data = JSON.parse(decodeURIComponent(item.data));
        } else {
            data = JSON.parse(item.data);
        }

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                debug('Can\'t send message %s, user %s is not found!', messageId, chatId);
                return;
            }

            var options = chat.options;

            var text = base.getNowStreamText(_this.gOptions, data);
            var caption = '';
            if (!options.hidePreview) {
                caption = base.getNowStreamPhotoText(_this.gOptions, data);
            }

            var chatList = [];
            if (chat.channelId) {
                if (!options.mute) {
                    chatList.push(chat.id);
                }
                chatList.push(chat.channelId);
            } else {
                chatList.push(chat.id);
            }

            return _this.gOptions.msgSender.sendNotify(messageId, imageFileId, chatList, caption, text, data, true).then(function () {
                _this.sendLog(chat.id, messageId, data);
            });
        });
    }).then(function () {
        return _this.removeItem(chatId, messageId);
    }).catch(function (err) {
        debug('sendItem', chatId, messageId, err);

        var timeout = 5 * 60;
        if (/PEER_ID_INVALID/.test(err)) {
            timeout = 6 * 60 * 60;
        }
        return _this.setTimeout(chatId, messageId, base.getNow() + timeout);
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
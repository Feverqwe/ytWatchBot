/**
 * Created by Anton on 21.05.2016.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:msgStack');
var debugLog = require('debug')('app:msgStack:log');
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

MsgStack.prototype.addChatIdsMessageId = function (connection, chatIds, messageId) {
    return new Promise(function (resolve, reject) {
        if (!chatIds.length) {
            return resolve();
        }
        var values = chatIds.map(function (id) {
            return [id, messageId];
        });
        connection.query('\
            INSERT INTO chatIdMessageId (chatId, messageId) VALUES ? ON DUPLICATE KEY UPDATE chatId = chatId; \
        ', [values], function (err, results) {
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
 * @property {String} messageId
 * @property {Number} timeout
 * @property {String} id
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
    delete debugItem._service;
    debugLog('[send] %s %s %j', messageId, chatId, debugItem);
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
        if (!ids.length) {
            return resolve([]);
        }
        db.connection.query('\
            SELECT id FROM messages WHERE id IN ?; \
            ', [[ids]], function (err, results) {
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

MsgStack.prototype.onSendMessageError = function (chatId, err) {
    var _this = this;
    var result = null;
    if (err.code === 'ETELEGRAM') {
        var body = err.response.body;

        var isBlocked = body.error_code === 403;
        if (!isBlocked) {
            isBlocked = [
                /group chat is deactivated/,
                /chat not found/,
                /channel not found/,
                /USER_DEACTIVATED/
            ].some(function (re) {
                return re.test(body.description);
            });
        }

        if (isBlocked) {
            if (/^@\w+$/.test(chatId)) {
                result = _this.gOptions.users.removeChatChannel(chatId);
            } else {
                result = _this.gOptions.users.removeChat(chatId);
            }
        } else
        if (body.parameters && body.parameters.migrate_to_chat_id) {
            result = _this.gOptions.users.changeChatId(chatId, parameters.migrate_to_chat_id);
        }
    }

    if (!result) {
        throw err;
    }

    return result;
};

MsgStack.prototype.sendItem = function (/*StackItem*/item) {
    var _this = this;
    var chatId = item.chatId;
    var messageId = item.messageId;
    var imageFileId = item.imageFileId;

    var timeout = 5 * 60;
    return _this.setTimeout(chatId, messageId, base.getNow() + timeout).then(function () {
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

            var chatList = [chat.id];
            if (chat.channelId) {
                chatList.push(chat.channelId);
                if (options.mute) {
                    chatList.shift();
                }
            }

            var message = {
                imageFileId: imageFileId,
                caption: caption,
                text: text
            };

            var promise = Promise.resolve();
            chatList.forEach(function (chatId) {
                promise = promise.then(function () {
                    return _this.gOptions.msgSender.sendMessage(chatId, messageId, message, data, true).then(function () {
                        _this.sendLog(chatId, messageId, data);
                    });
                });
            });
            return promise.catch(function (err) {
                return _this.onSendMessageError(chatId, err);
            });
        });
    }).then(function () {
        return _this.removeItem(chatId, messageId);
    }).catch(function (err) {
        debug('sendItem', chatId, messageId, err);

        if (/PEER_ID_INVALID/.test(err)) {
            timeout = 6 * 60 * 60;
        }
        return _this.setTimeout(chatId, messageId, base.getNow() + timeout);
    });
};

var activeChatIds = [];
var activeMessageIds = [];
var activePromises = [];

MsgStack.prototype.checkStack = function () {
    var _this = this;
    var limit = 10;
    if (activePromises.length >= limit) return;

    _this.getStackItems().then(function (/*[StackItem]*/items) {
        items.some(function (item) {
            var chatId = item.chatId;
            var messageId = item.messageId;
            var imageFileId = item.imageFileId;

            if (activePromises.length >= limit) return true;
            if (activeChatIds.indexOf(chatId) !== -1) return;
            if (!imageFileId && activeMessageIds.indexOf(messageId) !== -1) return;

            var promise = _this.sendItem(item);
            activeChatIds.push(chatId);
            activeMessageIds.push(messageId);
            activePromises.push(promise);

            var any = function () {
                base.removeItemFromArray(activeChatIds, chatId);
                base.removeItemFromArray(activeMessageIds, messageId);
                base.removeItemFromArray(activePromises, promise);
                _this.checkStack();
            };

            promise.then(function (result) {
                any();
                return result;
            }, function (err) {
                any();
                throw err;
            });
        });
    });
};

module.exports = MsgStack;